import asyncio
import json
import time
from typing import Any, Optional

from app.services.runs import agent as agent_mod
from app.services.runs import tools
from app.services.runs.rt import (GraphError, MAX_PARALLEL, MAX_STEPS, eval_expr,
                                  label_of, load_saved_graph, pick_edge, render_template)


class Engine:
    async def park(self, run, on: dict, node=None) -> dict:
        if run.pre_resumed is not None:
            payload = run.pre_resumed
            run.pre_resumed = None
            self.emit(run, node, "resumed", json.dumps(payload)[:300])
            return payload
        on = {**on, "parked_at": time.time()}
        run.status = "parked"
        run.parked_on = on
        run.checkpoint = {"node_id": getattr(node, "id", None), "context": run.cur_context}
        run.resume_event.clear()
        self.emit(run, node, "parked", json.dumps(on)[:300])
        self.persist(run)
        self.arm(run, on)
        await run.resume_event.wait()
        self.stop_watchers(run)
        run.status = "running"
        run.parked_on = None
        run.checkpoint = None
        payload = run.resume_payload or {}
        run.resume_payload = None
        self.emit(run, node, "resumed", json.dumps(payload)[:300])
        self.persist(run)
        return payload

    async def exec_tool(self, run, node, name: str, args: dict) -> Any:
        cfg = node.config or {}
        if tools.needs_approval(name, cfg):
            payload: dict = {"type": "approval", "tool": name, "args": args}
            if name == "write_file":
                diff = await asyncio.to_thread(tools.preview_diff, args)
                if diff is not None:
                    payload["diff"] = diff
            verdict = await self.park(run, payload, node)
            if not verdict.get("approved"):
                return {"error": f"tool call denied by user: {name}"}
        return await tools.call(name, args, run.mode == "simulate")

    async def node_agent(self, run, node, cfg, context, item):
        role = render_template(str(cfg.get("prompt") or f"You are the {node.label} agent."), run, context, item)
        evaluator = node.kind == "evaluator"

        async def emit_cb(phase: str, note) -> None:
            self.emit(run, node, phase, note)

        task = render_template(str(cfg["task"]), run, context, item) if cfg.get("task") else run.task
        if run.mode == "simulate":
            count = run.eval_count.get(node.id, 0)
            run.eval_count[node.id] = count + 1
            output = await agent_mod.run_simulated(label=node.label, task=task, context=context, evaluator=evaluator, revise=evaluator and count == 0 and self.has_revise(run, node), emit=emit_cb)
        else:
            output = await agent_mod.run_claude(role=role, task=task, context=context, cfg=cfg, evaluator=evaluator, emit=emit_cb, procs=run.procs)
        out_ctx = f"[{node.label}]\n{output[-4000:]}"
        self.emit(run, node, "output", output[:600])
        if evaluator:
            verdict = agent_mod.parse_verdict(output)
            self.emit(run, node, "loop" if verdict == "revise" else "exit", f"verdict: {verdict}")
            return out_ctx, verdict, None, None, output
        return out_ctx, None, None, None, output

    def has_revise(self, run, node) -> bool:
        return any(e.from_ == node.id and label_of(e) == "revise" for e in run.doc.edges)

    async def node_tool(self, run, node, cfg, context, item):
        name = str(cfg.get("tool") or "list_files")
        raw = cfg.get("args") or {}
        args = {k: (render_template(v, run, context, item) if isinstance(v, str) else v) for k, v in raw.items()} if isinstance(raw, dict) else {}
        self.emit(run, node, "tool", f"{name} {json.dumps(args)[:160]}")
        result = await self.exec_tool(run, node, name, args)
        text = json.dumps(result, default=str)
        self.emit(run, node, "result", text[:600])
        if (cfg.get("retries") or cfg.get("on_error")) and isinstance(result, dict) and result.get("error"):
            return context, None, None, str(result["error"])[:400], text
        return f"[{node.label} tool result]\n{text[:4000]}", None, None, None, text

    async def node_yield(self, run, node, cfg, context, item):
        on = cfg.get("event") if isinstance(cfg.get("event"), dict) else {"type": "manual"}
        payload = await self.park(run, dict(on), node)
        out = context + f"\n[{node.label} resumed]\n{json.dumps(payload)[:1000]}"
        return out, None, None, None, json.dumps(payload)

    async def node_transform(self, run, node, cfg, context, item):
        if cfg.get("expr"):
            val = eval_expr(str(cfg["expr"]), run, context, item)
            out = val if isinstance(val, str) else json.dumps(val, default=str)
        else:
            out = render_template(str(cfg.get("template") or "{{context}}"), run, context, item)
        self.emit(run, node, "output", out[:600])
        return out, None, None, None, out

    async def node_branch(self, run, node, cfg, context, item):
        expr = str(cfg.get("expr") or "context")
        val = bool(eval_expr(expr, run, context, item))
        self.emit(run, node, "output", f"{expr} -> {val}")
        return context, None, "true" if val else "false", None, str(val)

    async def node_call_graph(self, run, node, cfg, context, item):
        sub = load_saved_graph(str(cfg.get("graph") or ""))
        sub_ctx = render_template(str(cfg["task"]), run, context, item) if cfg.get("task") else context
        self.emit(run, node, "enter", f"subgraph {sub.name}")
        capture: dict = {}
        await self.walk(run, doc=sub, start_context=sub_ctx, capture=capture)
        if run.status == "failed":
            run.status = "running"
            return context, None, None, f"subgraph {sub.name} failed", None
        out = capture.get("context", context)
        return out, None, None, None, out

    async def exec_once(self, run, node, context: str, item: Any = None):
        handler = getattr(self, "node_" + ("agent" if node.kind == "evaluator" else node.kind), None)
        if handler is None or node.kind in ("start", "end", "foreach"):
            return context, None, None, None, context
        try:
            return await handler(run, node, node.config or {}, context, item)
        except asyncio.CancelledError:
            raise
        except (GraphError, agent_mod.AgentError) as err:
            return context, None, None, f"{node.kind} error: {err}", None
        except Exception as err:
            return context, None, None, f"{node.kind} error: {err}", None

    async def exec_step(self, run, node, context: str, item: Any = None):
        cfg = node.config or {}
        try:
            retries = max(0, min(9, int(cfg.get("retries") or 0)))
            backoff = max(0.05, float(cfg.get("backoff_s") or 1.0))
        except (TypeError, ValueError):
            retries, backoff = 0, 1.0
        rec = self.begin_visit(run, node, context, item)
        attempt = 0
        while True:
            ctx, verdict, route, err, raw = await self.exec_once(run, node, context, item)
            if not err or attempt >= retries:
                if not err:
                    run.outputs[node.id] = ctx[:4000]
                self.end_visit(run, rec, raw if raw is not None else ctx, err)
                self.persist(run)
                return ctx, verdict, route, err
            attempt += 1
            self.emit(run, node, "retry", f"attempt {attempt}/{retries} in {backoff:.1f}s: {err[:160]}")
            await asyncio.sleep(backoff)
            backoff *= 2

    def after_error(self, run, node, context: str, err: str):
        policy = str((node.config or {}).get("on_error") or "halt")
        if policy == "continue":
            ctx = context + f"\n[{node.label} error]\n{err}"
            run.outputs[node.id] = ctx[:4000]
            self.emit(run, node, "result", f"continuing past error: {err[:200]}")
            return ctx, None, False
        if policy == "route":
            self.emit(run, node, "result", f"error route: {err[:200]}")
            return context, "error", False
        self.emit(run, node, "halt", f"{node.label}: {err[:300]}")
        run.status = "failed"
        return context, None, True

    def guard(self, run, nodes: dict, node_id: str):
        run.steps += 1
        if run.steps > MAX_STEPS:
            self.emit(run, None, "halt", f"loop budget of {MAX_STEPS} exhausted")
            run.status = "failed"
            return None
        node = nodes.get(node_id)
        if node is None:
            self.emit(run, None, "halt", f"unknown node: {node_id}")
            run.status = "failed"
        return node

    def join_gate(self, run, node, context: str, in_deg: dict, join_state: dict):
        total = in_deg.get(node.id, 0)
        if total <= 1:
            return context, True
        st = join_state.setdefault(node.id, {"remaining": total, "ctx": []})
        st["ctx"].append(context)
        st["remaining"] -= 1
        if st["remaining"] > 0:
            self.emit(run, node, "waiting", f"join {total - st['remaining']}/{total}")
            return context, False
        del join_state[node.id]
        return "\n\n".join(st["ctx"]), True

    def route_step(self, run, node, outs, route: str):
        labeled = [e for e in outs if label_of(e) == route]
        if labeled:
            return labeled[0].to
        if route == "error":
            self.emit(run, node, "halt", "error route requested but no 'error' edge")
            run.status = "failed"
            return None
        if route == "done":
            others = [e for e in outs if label_of(e) != "each"]
            if not others:
                self.emit(run, node, "exit", "foreach is terminal")
                return None
            return others[0].to
        return (outs[0] if route == "true" else outs[-1]).to

    async def walk(self, run, start_node: Optional[str] = None, start_context: str = "", doc: Any = None, capture: Optional[dict] = None) -> None:
        doc = doc or run.doc
        nodes = {n.id: n for n in doc.nodes}
        out_edges: dict[str, list] = {}
        in_deg: dict[str, int] = {}
        for e in doc.edges:
            out_edges.setdefault(e.from_, []).append(e)
            if nodes[e.from_].kind != "evaluator":
                in_deg[e.to] = in_deg.get(e.to, 0) + 1
        join_state: dict = {}
        starts = [n for n in doc.nodes if n.kind == "start"]
        if not starts and not start_node:
            run.status = "failed"
            self.emit(run, None, "halt", "graph has no start node")
            return

        async def visit(node_id: str, context: str) -> None:
            gated = True
            while True:
                node = self.guard(run, nodes, node_id)
                if node is None:
                    return
                run.cur_context = context
                proceed = True
                if gated:
                    context, proceed = self.join_gate(run, node, context, in_deg, join_state)
                gated = True
                if not proceed:
                    return
                self.emit(run, node, "enter")
                if node.kind == "end":
                    self.emit(run, node, "exit", "subgraph complete" if capture is not None else "run complete")
                    if capture is not None:
                        capture["context"] = context
                    return
                verdict = None
                if node.kind == "start":
                    route, err = None, None
                elif node.kind == "foreach":
                    context, route, err = await self.exec_foreach(run, node, context, nodes, out_edges)
                    if not err:
                        run.outputs[node.id] = context[:4000]
                else:
                    context, verdict, route, err = await self.exec_step(run, node, context)
                if err:
                    context, route, halted = self.after_error(run, node, context, err)
                    if halted:
                        return
                outs = out_edges.get(node_id, [])
                if not outs:
                    self.emit(run, node, "halt", "no outgoing edges")
                    return
                if verdict is not None:
                    node_id = pick_edge(outs, verdict, node, nodes).to
                    gated = False
                    continue
                if route:
                    nxt = self.route_step(run, node, outs, route)
                    if nxt is None:
                        return
                    node_id = nxt
                    continue
                self.emit(run, node, "exit")
                if len(outs) == 1:
                    node_id = outs[0].to
                    continue
                await asyncio.gather(*(visit(e.to, context) for e in outs))
                return

        await visit(start_node or starts[0].id, start_context)

    async def run_chain(self, run, nodes: dict, out_edges: dict, node_id: str, context: str, item: Any):
        while True:
            run.steps += 1
            if run.steps > MAX_STEPS:
                return context, f"loop budget of {MAX_STEPS} exhausted"
            node = nodes.get(node_id)
            if node is None:
                return context, f"unknown node: {node_id}"
            if node.kind == "foreach":
                return context, "nested foreach isn't supported"
            if node.kind == "end":
                return context, None
            self.emit(run, node, "enter", f"item {json.dumps(item, default=str)[:80]}")
            context, verdict, route, err = await self.exec_step(run, node, context, item)
            if err:
                context, route, halted = self.after_error(run, node, context, err)
                if halted:
                    run.status = "running"
                    return context, err
            outs = out_edges.get(node_id, [])
            if not outs:
                return context, None
            if verdict is not None:
                node_id = pick_edge(outs, verdict, node, nodes).to
                continue
            if route:
                labeled = [e for e in outs if label_of(e) == route]
                if labeled:
                    node_id = labeled[0].to
                    continue
                if route == "error":
                    return context, "error route requested but no 'error' edge"
                node_id = (outs[0] if route == "true" else outs[-1]).to
                continue
            if len(outs) > 1:
                return context, "fan-out inside a foreach body isn't supported"
            node_id = outs[0].to

    def foreach_items(self, run, cfg, context):
        src = str(cfg.get("items") or "")
        try:
            items = eval_expr(src, run, context) if src else []
        except GraphError:
            try:
                items = json.loads(render_template(src, run, context))
            except (ValueError, TypeError):
                return None, f"foreach items didn't evaluate: {src[:120]}"
        if isinstance(items, (str, bytes)) or not hasattr(items, "__iter__"):
            items = [items]
        return list(items), None

    async def exec_foreach(self, run, node, context: str, nodes: dict, out_edges: dict):
        cfg = node.config or {}
        outs = out_edges.get(node.id, [])
        each = next((e for e in outs if label_of(e) == "each"), None)
        if each is None and len(outs) == 2:
            each = outs[0]
        rec = self.begin_visit(run, node, context, None)
        if each is None:
            err = "foreach needs an out-edge labeled 'each'"
            self.end_visit(run, rec, None, err)
            return context, None, err
        items, item_err = self.foreach_items(run, cfg, context)
        if item_err:
            self.end_visit(run, rec, None, item_err)
            return context, None, item_err
        try:
            par = min(MAX_PARALLEL, max(1, int(cfg.get("parallel") or 1)))
        except (TypeError, ValueError):
            par = 1
        self.emit(run, node, "tool", f"{len(items)} items · parallel {par}")
        sem = asyncio.Semaphore(par)
        errors: list[str] = []
        results: list[str] = [""] * len(items)

        async def one(i: int, it: Any) -> None:
            async with sem:
                ctx, err = await self.run_chain(run, nodes, out_edges, each.to, context, it)
                results[i] = ctx
                if err:
                    errors.append(f"item {i}: {err}")

        await asyncio.gather(*(one(i, it) for i, it in enumerate(items)))
        joined = "\n\n".join(f"[{node.label} item {i}]\n{r[-1500:]}" for i, r in enumerate(results))
        if errors:
            err = "; ".join(errors)[:400]
            self.end_visit(run, rec, joined, err)
            return joined, None, err
        self.emit(run, node, "result", f"{len(items)} items complete")
        self.end_visit(run, rec, joined, None)
        return joined, "done", None
