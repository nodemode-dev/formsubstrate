# Verification recipes

Replace names in square brackets. Scratch work goes under your own scratch folder; never into `frontend/dist` or `src-tauri/target`.

## Typecheck and build

```bash
cd /home/claude/repos/subform/frontend
npx tsc --noEmit
npx vite build --outDir [scratch]/dist
```

## Engine

```bash
cd /home/claude/repos/subform/backend
venv/bin/python -c "import app.main"
SUBFORM_DATA_DIR=[scratch]/data SUBFORM_DIST=[scratch]/dist \
  venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port [port] &
echo $! > [scratch]/engine.pid
curl -s http://127.0.0.1:[port]/api/system/status
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:[port]/api/formslot/start
kill $(cat [scratch]/engine.pid)
```

The second curl shows 403 without the window token. To prove LocalGuard, send `-H 'Host: example.com'` and expect 403.

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
