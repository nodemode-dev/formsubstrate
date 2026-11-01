import json
import time

import httpx

from app.core import config

CATALOG_DATE = "2026-07-19"
LIVE_TTL = 3600.0


def _group(vendor: str, *pairs: tuple[str, str]) -> dict:
    return {"vendor": vendor, "models": [{"id": i, "label": n} for i, n in pairs]}


MODEL_CATALOG: list[dict] = [
    _group("Router", ("openrouter/auto", "Auto (best available)"), ("openrouter/free", "Free router")),
    _group("Anthropic", ("anthropic/claude-fable-5", "Claude Fable 5"), ("anthropic/claude-opus-4.8", "Claude Opus 4.8"),
           ("anthropic/claude-opus-4.8-fast", "Claude Opus 4.8 Fast"), ("anthropic/claude-sonnet-5", "Claude Sonnet 5"),
           ("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"), ("anthropic/claude-haiku-4.5", "Claude Haiku 4.5")),
    _group("OpenAI", ("openai/gpt-5.6-sol", "GPT-5.6 Sol"), ("openai/gpt-5.6-luna", "GPT-5.6 Luna"),
           ("openai/gpt-5.6-terra", "GPT-5.6 Terra"), ("openai/gpt-5.5-pro", "GPT-5.5 Pro"), ("openai/gpt-5.5", "GPT-5.5"),
           ("openai/gpt-5.3-codex", "GPT-5.3 Codex"), ("openai/gpt-5.1-codex-max", "GPT-5.1 Codex Max"),
           ("openai/gpt-5.1-codex-mini", "GPT-5.1 Codex Mini"), ("openai/gpt-5.4-mini", "GPT-5.4 Mini"),
           ("openai/gpt-5.4-nano", "GPT-5.4 Nano")),
    _group("Google", ("google/gemini-3.5-flash", "Gemini 3.5 Flash"), ("google/gemini-3-flash-preview", "Gemini 3 Flash Preview"),
           ("google/gemini-3.1-pro-preview", "Gemini 3.1 Pro"), ("google/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite"),
           ("google/gemini-2.5-pro", "Gemini 2.5 Pro")),
    _group("xAI", ("x-ai/grok-4.5", "Grok 4.5"), ("x-ai/grok-4.3", "Grok 4.3"),
           ("x-ai/grok-4.20-multi-agent", "Grok 4.20 Multi-Agent"), ("x-ai/grok-build-0.1", "Grok Build 0.1")),
    _group("DeepSeek", ("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"), ("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"),
           ("deepseek/deepseek-v3.2", "DeepSeek V3.2")),
    _group("Qwen", ("qwen/qwen3-max", "Qwen3 Max"), ("qwen/qwen3-max-thinking", "Qwen3 Max Thinking"),
           ("qwen/qwen3-coder-next", "Qwen3 Coder Next"), ("qwen/qwen3-coder-plus", "Qwen3 Coder Plus"),
           ("qwen/qwen3-next-80b-a3b-instruct", "Qwen3 Next 80B")),
    _group("Moonshot", ("moonshotai/kimi-k3", "Kimi K3"), ("moonshotai/kimi-k2.7-code", "Kimi K2.7 Code"),
           ("moonshotai/kimi-k2.6", "Kimi K2.6"), ("moonshotai/kimi-k2.5", "Kimi K2.5")),
    _group("Z.ai", ("z-ai/glm-5.2", "GLM-5.2"), ("z-ai/glm-5", "GLM-5"), ("z-ai/glm-5-turbo", "GLM-5 Turbo"),
           ("z-ai/glm-4.7-flash", "GLM-4.7 Flash")),
    _group("Meta", ("meta-llama/llama-4-maverick", "Llama 4 Maverick"), ("meta-llama/llama-4-scout", "Llama 4 Scout")),
    _group("Mistral", ("mistralai/mistral-large-2512", "Mistral Large 2512"), ("mistralai/mistral-medium-3-5", "Mistral Medium 3.5"),
           ("mistralai/devstral-2512", "Devstral 2512"), ("mistralai/codestral-2508", "Codestral 2508")),
    _group("MiniMax", ("minimax/minimax-m3", "MiniMax M3"), ("minimax/minimax-m2.5", "MiniMax M2.5"),
           ("minimax/minimax-m2.7", "MiniMax M2.7")),
    _group("Tencent", ("tencent/hy3", "Hy3"), ("tencent/hy3:free", "Hy3 (free)")),
    _group("NVIDIA", ("nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra 550B"),
           ("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super (free)")),
    _group("Amazon", ("amazon/nova-premier-v1", "Nova Premier"), ("amazon/nova-2-lite-v1", "Nova 2 Lite")),
]

CLI_MODELS: list[dict] = [
    {"id": "", "label": "CLI default model"},
    {"id": "fable", "label": "Claude Fable (alias)"},
    {"id": "opus", "label": "Claude Opus (alias)"},
    {"id": "sonnet", "label": "Claude Sonnet (alias)"},
    {"id": "haiku", "label": "Claude Haiku (alias)"},
]


def _m(handle: str, kind: str, model: str, prompt: str, full: bool = False) -> dict:
    return {"handle": handle, "kind": kind, "model": model, "full_access": full, "role_prompt": prompt}


MEMBER_PRESETS: dict[str, dict] = {
    "fable-sol-opus": {
        "label": "fable / sol / opus (side-by-side trio)",
        "note": "Fable orchestrates on the CLI, GPT-5.6 Sol hyper-analyses over the API, Opus engineers on a second CLI session; each only sees messages that mention it",
        "members": [
            _m("fable", "claude", "fable", "You are the creative, forward-thinking product lead of this team. Orchestrate: break goals down, delegate design and analysis to @sol and implementation to @opus, track the whole thread, and look for out-of-the-box solutions others miss. You hold the plan and the history."),
            _m("sol", "agent", "openai/gpt-5.6-sol", "You are the obsessive tech lead. Before code is written, trace every bug to its exact source, analyse each proposed solution and its edge cases, and make the architecture bulletproof. Push back with specifics. Hand approved designs to @opus; flag risks to @fable."),
            _m("opus", "claude", "opus", "You are the workhorse software engineer. Implement what @fable and @sol hand you, in the workspace, step by step. If something is unclear or looks wrong, say so and ask before building on sand. Report what you actually changed, with file paths."),
        ],
    },
    "frontier-council": {
        "label": "frontier council (barrier group review)",
        "note": "mention @anth @oai @kimi together and the group barrier runs three vendors independently, then bundles every verdict; @scribe synthesizes the bundle",
        "members": [
            _m("anth", "agent", "anthropic/claude-opus-4.8", "Council seat one. Review the request independently and deliver a verdict: correct, risky, or wrong, with the strongest concrete reasons. Do not defer to other seats. End with a one-line summary addressed to @scribe unless you truly have nothing to add."),
            _m("oai", "agent", "openai/gpt-5.6-terra", "Council seat two. Independently analyse the same request: hunt for failure modes, missing requirements, and simpler designs. Disagree openly when warranted. End with a one-line summary addressed to @scribe unless you truly have nothing to add."),
            _m("kimi", "agent", "moonshotai/kimi-k3", "Council seat three. Independently stress the request from the implementation side: what breaks in real code, at scale, in the frontend, over a long horizon. End with a one-line summary addressed to @scribe unless you truly have nothing to add."),
            _m("scribe", "agent", "anthropic/claude-sonnet-4.6", "You are the council scribe. When the round bundle reaches you, merge the seats' verdicts into one decision: points of agreement, real disagreements with your call on each, and the recommended next action. Mention nobody; your synthesis closes the group and the operator reads it."),
        ],
    },
    "open-swarm": {
        "label": "open swarm (budget open-weight crew)",
        "note": "four open-weight coding leaders: DeepSeek V4 Flash scouts, GLM-5.2 implements, MiniMax M2.5 verifies, Kimi K2.6 sweeps",
        "members": [
            _m("scout", "agent", "deepseek/deepseek-v4-flash", "You are the recon scout. Read the workspace fast and cheap: map the relevant files, current behavior, and constraints for the task, then hand a tight briefing to @forge. Never implement; your product is an accurate map."),
            _m("forge", "agent", "z-ai/glm-5.2", "You are the implementer. Take @scout's map and the operator's intent and make the change: minimal, surgical edits in the workspace. When done, hand exactly what you changed to @probe for verification."),
            _m("probe", "agent", "minimax/minimax-m2.5", "You are the verifier. Take @forge's change list and prove it works: run or reason through the tests, probe the edge cases, and report pass or a precise failure back to @forge. Do not fix; your product is evidence."),
            _m("sweep", "agent", "moonshotai/kimi-k2.6", "You are the sweeper. After @probe passes a change, tidy the aftermath: naming, dead code, and a short summary of the change for the channel. Keep diffs tiny and mention nobody when done."),
        ],
    },
    "spec-build-verify": {
        "label": "spec / build / verify (contract-first)",
        "note": "Sonnet 4.6 writes the spec with acceptance criteria, the Claude CLI builds it in the workspace, MiniMax M2.7 verifies against the criteria and loops or closes",
        "members": [
            _m("spec", "agent", "anthropic/claude-sonnet-4.6", "You write contracts, not code. Turn the operator's ask into a numbered spec with explicit acceptance criteria and non-goals, then hand it to @build. When @verify reports, either close with a summary (mention nobody) or send @build the precise delta still owed."),
            _m("build", "claude", "opus", "You implement @spec's contract in the workspace, criterion by criterion, nothing more. Note any criterion you could not meet honestly. When done, hand the change list to @verify."),
            _m("verify", "agent", "minimax/minimax-m2.7", "You are the acceptance gate. Check @build's work against each numbered criterion from @spec: pass or fail with evidence per line. Report the scorecard to @spec. You never implement."),
        ],
    },
    "red-team": {
        "label": "red team (build / break / patch)",
        "note": "CLI Sonnet builds, Grok 4.5 attacks the result, GLM-5.2 patches confirmed findings; set a turn brake on the channel, adversarial loops burn tokens by design",
        "members": [
            _m("builder", "claude", "sonnet", "You build the requested feature in the workspace, plainly and correctly. When done, hand @breaker the surface: entry points, inputs, and assumptions you made."),
            _m("breaker", "agent", "x-ai/grok-4.5", "You are the adversary. Attack @builder's work: hostile inputs, race and injection angles, broken assumptions, resource abuse. Report only findings you can concretely demonstrate, ranked by severity, to @patch. No findings means say so and mention nobody."),
            _m("patch", "agent", "z-ai/glm-5.2", "You fix what @breaker proves. One surgical patch per confirmed finding in the workspace, with a one-line rationale each. Then hand the patched surface back to @breaker for one re-check."),
        ],
    },
    "pair-lite": {
        "label": "pair lite (near-free duo)",
        "note": "DeepSeek V4 Flash writes, Gemini 3 Flash reviews: the cheapest pairing that still argues back",
        "members": [
            _m("dev", "agent", "deepseek/deepseek-v4-flash", "You are the driver. Do the operator's task directly in the workspace, briefly narrating intent. Hand each finished piece to @critic; fold their review in without ceremony."),
            _m("critic", "agent", "google/gemini-3-flash-preview", "You are the navigator. Review @dev's work fast: correctness first, then clarity. Give at most three concrete fixes per pass, or approve outright back to @dev. Never rewrite wholesale."),
        ],
    },
}

_live: dict = {"ts": 0.0, "pricing": {}, "extra": []}


def _cache_file():
    return config.data_dir() / "cogentics-models.json"


async def refresh_live(llm) -> dict:
    now = time.time()
    if now - _live["ts"] < LIVE_TTL and _live["pricing"]:
        return _live
    if not llm.configured or llm.provider == "custom":
        _load_disk()
        return _live
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{llm.base_url}/models", headers=llm.headers())
        res.raise_for_status()
        data = res.json().get("data", [])
    except (httpx.HTTPError, ValueError):
        _load_disk()
        return _live
    known = {m["id"] for g in MODEL_CATALOG for m in g["models"]}
    pricing: dict[str, dict] = {}
    extra: list[dict] = []
    for m in data:
        mid = m.get("id", "")
        pr = m.get("pricing") or {}
        try:
            pricing[mid] = {"prompt": float(pr.get("prompt") or 0), "completion": float(pr.get("completion") or 0)}
        except (TypeError, ValueError):
            pricing[mid] = {"prompt": 0.0, "completion": 0.0}
        if mid not in known:
            extra.append({"id": mid, "label": m.get("name") or mid})
    extra.sort(key=lambda m: m["id"])
    _live.update({"ts": now, "pricing": pricing, "extra": extra[:400]})
    try:
        _cache_file().write_text(json.dumps({"ts": now, "pricing": pricing, "extra": _live["extra"]}), encoding="utf-8")
    except OSError:
        return _live
    return _live


def _load_disk() -> None:
    try:
        _live.update(json.loads(_cache_file().read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return


def has_live() -> bool:
    return bool(_live["pricing"])


def merged_catalog() -> list[dict]:
    out = [dict(g, models=[dict(m, pricing=_live["pricing"].get(m["id"])) for m in g["models"]]) for g in MODEL_CATALOG]
    if _live["extra"]:
        out.append({"vendor": "Live (uncurated)", "models": _live["extra"]})
    return out


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    pr = _live["pricing"].get(model)
    if not pr:
        return None
    return prompt_tokens * pr["prompt"] + completion_tokens * pr["completion"]
