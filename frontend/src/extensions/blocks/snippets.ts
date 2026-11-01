import type { Block } from './registry';

const box = 'border:1px solid #8884;border-radius:12px;padding:20px';
const field = 'width:100%;padding:10px;border-radius:8px;border:1px solid #8886;background:transparent;color:inherit';

const make = (id: string, label: string, hint: string, icon: string, code: string): Block => ({ id: `snippet:${id}`, group: 'snippet', label, hint, icon, code });

export const SNIPPETS: Block[] = [
  make('page', 'Page scaffold', 'Full HTML5 document', 'file', `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Untitled</title>
  <style>
    :root { color-scheme: dark light; font-family: system-ui, sans-serif; }
    body { margin: 0; }
    main { max-width: 960px; margin: 0 auto; padding: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>Hello</h1>
  </main>
</body>
</html>
`),
  make('nav', 'Nav bar', 'Site header with links', 'menu', `<header style="display:flex;align-items:center;gap:24px;padding:16px 24px;border-bottom:1px solid #8884">
  <strong>Brand</strong>
  <nav style="display:flex;gap:16px;margin-left:auto">
    <a href="#">Home</a>
    <a href="#">Docs</a>
    <a href="#">About</a>
  </nav>
</header>
`),
  make('hero', 'Hero', 'Headline and call to action', 'viewGrid', `<section style="padding:96px 24px;text-align:center">
  <h1 style="font-size:44px;margin:0 0 12px">A bold headline</h1>
  <p style="opacity:.75;max-width:520px;margin:0 auto 28px">One supporting sentence that says what this is and why it matters.</p>
  <a href="#" style="display:inline-block;padding:12px 28px;border-radius:999px;background:#7c5cff;color:#fff;text-decoration:none;font-weight:600">Get started</a>
</section>
`),
  make('grid', 'Feature grid', 'Three-up card grid', 'viewGrid', `<section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;padding:24px">
  <article style="${box}"><h3 style="margin:0 0 8px">Feature one</h3><p style="margin:0;opacity:.7">Short description of the first thing.</p></article>
  <article style="${box}"><h3 style="margin:0 0 8px">Feature two</h3><p style="margin:0;opacity:.7">Short description of the second thing.</p></article>
  <article style="${box}"><h3 style="margin:0 0 8px">Feature three</h3><p style="margin:0;opacity:.7">Short description of the third thing.</p></article>
</section>
`),
  make('form', 'Contact form', 'Labeled inputs and submit', 'newFile', `<form style="display:grid;gap:12px;max-width:420px;padding:24px">
  <label>Name<br /><input name="name" required style="${field}" /></label>
  <label>Email<br /><input name="email" type="email" required style="${field}" /></label>
  <label>Message<br /><textarea name="message" rows="4" style="${field}"></textarea></label>
  <button type="submit" style="padding:12px;border-radius:8px;border:none;background:#7c5cff;color:#fff;font-weight:600">Send</button>
</form>
`),
  make('footer', 'Footer', 'Site footer', 'panelNav', `<footer style="padding:32px 24px;border-top:1px solid #8884;opacity:.7;display:flex;gap:16px;flex-wrap:wrap">
  <span>&copy; 2026 Brand</span>
  <a href="#" style="margin-left:auto">Privacy</a>
  <a href="#">Terms</a>
</footer>
`),
  make('media', 'Media block', 'Image and text split', 'previewSide', `<section style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center;padding:48px 24px">
  <img src="https://placehold.co/560x360" alt="" style="width:100%;border-radius:12px" />
  <div>
    <h2 style="margin:0 0 10px">Side-by-side</h2>
    <p style="opacity:.75">Pair an image with supporting copy.</p>
  </div>
</section>
`),
  make('table', 'Data table', 'Styled table', 'viewList', `<table style="width:100%;border-collapse:collapse;margin:24px 0">
  <thead>
    <tr style="text-align:left;border-bottom:1px solid #8886"><th style="padding:10px">Name</th><th style="padding:10px">Value</th></tr>
  </thead>
  <tbody>
    <tr style="border-bottom:1px solid #8884"><td style="padding:10px">Alpha</td><td style="padding:10px">42</td></tr>
    <tr style="border-bottom:1px solid #8884"><td style="padding:10px">Beta</td><td style="padding:10px">7</td></tr>
  </tbody>
</table>
`),
];
