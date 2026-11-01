import type { Commands } from './commands';
import { el, patchList, q, setClass, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import { icon } from './icons';
import { loadPrefs } from './prefs';
import { THEMES, readChoice, setTheme } from './themes';

const SHOWN = 8;

export class TitleTools {
  readonly root = el('<div class="cv-title-tools"></div>');
  readonly workspaceSelect = el<HTMLSelectElement>('<select class="cv-tt-select" aria-label="Workspace" hidden data-native></select>');
  private readonly theme: HTMLButtonElement;
  private readonly agent: HTMLButtonElement;
  private readonly terminal: HTMLButtonElement;
  private readonly sun: HTMLElement;
  private readonly moon: HTMLElement;
  private readonly pop = el('<div class="cv-search-pop" hidden><input class="cv-search-input" type="search" placeholder="Search commands" aria-label="Search commands"><div class="cv-search-results" role="listbox"></div></div>');
  private readonly input = q<HTMLInputElement>(this.pop, 'input');
  private readonly results = q(this.pop, '.cv-search-results');
  private found: Array<{ id: string; label: string; keys: string }> = [];
  private picked = 0;

  constructor(host: HTMLElement, private readonly commands: Commands) {
    this.theme = el<HTMLButtonElement>(`<button class="cv-tt-btn" type="button" title="${t('Light or dark')}" aria-label="${t('Light or dark')}"><span class="cv-tt-sun">${icon('sun', 16)}</span><span class="cv-tt-moon">${icon('moon', 16)}</span></button>`);
    this.sun = q(this.theme, '.cv-tt-sun');
    this.moon = q(this.theme, '.cv-tt-moon');
    const search = el<HTMLButtonElement>(`<button class="cv-tt-btn" type="button" title="${t('Search commands')}" aria-label="${t('Search commands')}">${icon('search', 16)}</button>`);
    this.agent = el<HTMLButtonElement>(`<button class="cv-tt-btn" type="button" title="${t('Claude Code')}" aria-label="${t('Claude Code')}">${icon('agent', 16)}</button>`);
    this.terminal = el<HTMLButtonElement>(`<button class="cv-tt-btn" type="button" title="${t('Show Terminal')}" aria-label="${t('Show Terminal')}">${icon('terminal', 16)}</button>`);
    this.theme.addEventListener('click', () => { setTheme(THEMES[readChoice().theme]?.light ? loadPrefs().themeDark : 'light'); this.syncTheme(); });
    this.agent.addEventListener('click', () => { commands.run('agent-new'); });
    this.terminal.addEventListener('click', () => { commands.run('terminal-toggle'); });
    search.addEventListener('click', () => this.open());
    this.input.addEventListener('input', () => { this.picked = 0; this.fill(this.input.value); });
    this.input.addEventListener('keydown', (e) => {
      const n = this.found.length;
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { this.picked = (this.picked + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; this.mark(); } return; }
      if (e.key === 'Enter') (this.results.children[this.picked] as HTMLElement | undefined)?.click();
    });
    this.results.addEventListener('click', (e) => {
      const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.cv-search-item')?.dataset.key : undefined;
      if (!id) return;
      this.close();
      commands.run(id);
    });
    document.addEventListener('pointerdown', (e) => { if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !search.contains(e.target as Node)) this.close(); });
    document.addEventListener('nm:ui-settings-changed', () => this.syncTheme());
    this.root.append(this.theme, search, this.agent, this.terminal, this.workspaceSelect, this.pop);
    host.appendChild(this.root);
    this.syncTheme();
    this.sync();
  }

  sync(): void {
    for (const [btn, id] of [[this.agent, 'agent-new'], [this.terminal, 'terminal-toggle']] as const) {
      const cmd = this.commands.get(id);
      setDisabled(btn, !cmd || !this.commands.enabled(cmd));
    }
  }

  open(): void {
    setHidden(this.pop, false);
    this.input.value = '';
    this.picked = 0;
    this.fill('');
    this.input.focus();
  }

  close(): void { setHidden(this.pop, true); }

  private syncTheme(): void {
    const light = !!THEMES[readChoice().theme]?.light;
    setHidden(this.sun, light);
    setHidden(this.moon, !light);
    this.theme.setAttribute('aria-pressed', String(light));
  }

  private fill(query: string): void {
    const c = this.commands, needle = query.trim().toLowerCase();
    this.found = c.all()
      .filter((cmd) => c.enabled(cmd) && c.label(cmd) && (!needle || c.label(cmd).toLowerCase().includes(needle)))
      .slice(0, SHOWN)
      .map((cmd) => ({ id: cmd.id, label: c.label(cmd).replace(/\.\.\.$/, '…'), keys: c.keyLabel(cmd) }));
    patchList(this.results, this.found, {
      key: (f) => f.id,
      create: (f) => {
        const b = el<HTMLButtonElement>('<button class="cv-search-item" type="button" role="option"><span class="cv-search-label"></span><span class="cv-search-keys"></span></button>');
        b.dataset.key = f.id;
        setText(q(b, '.cv-search-label'), f.label);
        setText(q(b, '.cv-search-keys'), f.keys);
        return b;
      },
      update: (b, f) => { setText(q(b, '.cv-search-label'), f.label); setText(q(b, '.cv-search-keys'), f.keys); },
    });
    this.mark();
  }

  private mark(): void {
    Array.from(this.results.children).forEach((b, i) => {
      setClass(b, 'is-picked', i === this.picked);
      b.setAttribute('aria-selected', String(i === this.picked));
    });
  }
}
