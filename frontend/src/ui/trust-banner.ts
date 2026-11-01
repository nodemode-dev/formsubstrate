import { isTrusted, markAsked, setTrusted, wasAsked } from '../io/trust';
import { el, q, setHidden, setText } from './dom';
import { t } from './i18n';
import { icon } from './icons';
import type { WorkspaceStore } from './workspace-store';

export class TrustBanner {
  readonly el = el(`<div class="cv-trust" role="region" hidden>
    <span class="cv-trust-icon">${icon('shield', 18)}</span>
    <div class="cv-trust-text"><div class="cv-trust-title"></div><div class="cv-trust-sub"></div></div>
    <div class="cv-trust-actions">
      <button class="cv-btn cv-btn-primary" type="button" data-act="trust"></button>
      <button class="cv-btn cv-btn-ghost" type="button" data-act="later"></button>
    </div>
  </div>`);
  private readonly title = q(this.el, '.cv-trust-title');
  private readonly sub = q(this.el, '.cv-trust-sub');
  private path = '';

  constructor(host: HTMLElement, private readonly store: WorkspaceStore) {
    this.el.setAttribute('aria-label', t('Workspace trust'));
    setText(q(this.el, '[data-act="trust"]'), t('Trust this workspace'));
    setText(q(this.el, '[data-act="later"]'), t('Not now'));
    this.el.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (!b || !this.path) return;
      if (b.dataset.act === 'trust') setTrusted(this.path, true); else markAsked(this.path);
      setHidden(this.el, true);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (this.path) markAsked(this.path);
      setHidden(this.el, true);
    });
    host.append(this.el);
    store.on('workspace', () => this.sync());
    this.sync();
  }

  private sync(): void {
    const ws = this.store.workspace;
    const tools = ws?.localTools ?? [];
    this.path = ws?.path ?? '';
    if (!ws || tools.length === 0 || isTrusted(ws.path) || wasAsked(ws.path)) { setHidden(this.el, true); return; }
    setText(this.title, `${t('Trust')} ${ws.name}?`);
    setText(this.sub, `${t('This workspace has its own tools:')} ${tools.join(', ')}. ${t('Trusting it lets subform run them for language features and debugging. Change this any time in Preferences.')}`);
    setHidden(this.el, false);
  }
}
