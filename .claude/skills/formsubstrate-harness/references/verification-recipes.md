# Verification recipes

Replace names in square brackets. Scratch work goes under your own scratch folder; never into `frontend/dist` or `src-tauri/target`.

## Typecheck and build

```bash
cd /home/claude/repos/formsubstrate/frontend
npx tsc --noEmit
npx vite build --outDir [scratch]/dist
```

## Engine

```bash
cd /home/claude/repos/formsubstrate/backend
venv/bin/python -c "import app.main"
FORMSUBSTRATE_DATA_DIR=[scratch]/data FORMSUBSTRATE_DIST=[scratch]/dist \
  venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port [port] &
echo $! > [scratch]/engine.pid
curl -s http://127.0.0.1:[port]/api/system/status
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:[port]/api/formslot/start
kill $(cat [scratch]/engine.pid)
```

The second curl shows 403 without the window token. To prove LocalGuard, send `-H 'Host: example.com'` and expect 403.

## MCP at /mcp

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:[port]/mcp -d '{}'
curl -s -X POST http://127.0.0.1:[port]/mcp -H 'Authorization: Bearer [token]' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The first answers 401 (no token). The second lists nine tools with a window token or a session gate token. A session token sees only its own session. `terminal_tail` needs a terminal id from `terminal_list`; its `next_offset` goes back in as `since`.

## Gate hook, run for real

The hook is `[data]/hooks/sf_gate.py`, written by the engine when a session starts (`gates.ensure_script`). Run it by hand against a scratch engine and a scratch git worktree, with the variables a session would have, and the payload on stdin:

```bash
echo '{"session_id":"","tool_name":"Bash","tool_input":{"command":"echo x > notes.txt"}}' | \
  FORMSUBSTRATE_ENGINE=http://127.0.0.1:[port] FORMSUBSTRATE_SESSION=[id] FORMSUBSTRATE_WORKTREE=[worktree] \
  FORMSUBSTRATE_REPO=[repo] FORMSUBSTRATE_GATE_TOKEN=[token] FORMSLOT_BIN=[fake or copied formslot] \
  python3 [data]/hooks/sf_gate.py
```

Add `"hook_event_name":"PostToolUse"` to the payload to exercise the after-check. Use a copy of a formslot store (`FORMSLOT_DATA_DIR`), never the owner's live one. Show the stdout JSON, the exit code, and any `[data]/hooks/sf_gate.log` line. To prove a gate, open one through `POST /api/gates` with the session token, answer it with the window token at `POST /api/gates/{id}/answer`, and retry: Use or Adapt gates again, Write new anyway passes for identical content only. The command-size and step limits are constants at the top of `SCRIPT` in `backend/app/services/gate_hook.py`.

## Throttled Playwright skeleton

```javascript
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('http://127.0.0.1:[port]/');
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => window.__cls);
  console.log(JSON.stringify({ cls, errors }));
  await browser.close();
})();
```

Run with `NODE_PATH=$(npm root -g) node [scratch]/check.js`. Keep the script outside the repo. Add the clicks that exercise your feature between load and the final read. Report `cls` and `errors`.

## Static scans before reporting

Read-only greps over your changed files: comments in source, emoji, U+2014 in markdown, `Co-Authored-By`, `innerHTML` on live containers, raw `z-index` numbers in CSS.
