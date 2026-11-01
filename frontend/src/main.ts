import { revealApp } from './ui/dom';

const FONT_WAIT_MS = 2500;

function buildShell(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing element: #app');
  const region = document.createElement('div');
  region.className = 'shell-placeholder';
  region.textContent = 'subform';
  app.append(region);
}

function fontsReady(): Promise<unknown> {
  const wait = new Promise<void>((resolve) => { window.setTimeout(resolve, FONT_WAIT_MS); });
  return Promise.race([document.fonts.ready, wait]);
}

buildShell();
void fontsReady().then(revealApp);
