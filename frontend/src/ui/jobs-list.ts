import { el, patchList, q, setHidden, setStyleVar, setText, setTitle } from './dom';
import { onLanguage, t } from './i18n';
import type { Job, WorkspaceStore } from './workspace-store';

export class JobsList {
  private readonly root = el<HTMLElement>(
    '<div class="cv-jobs" role="dialog" aria-label="Jobs" hidden><div class="cv-jobs-head"><span class="cv-jobs-title"></span><span class="cv-jobs-count"></span></div>' +
    '<div class="cv-jobs-list" role="list"></div><p class="cv-jobs-empty"></p></div>');
  private readonly list = q(this.root, '.cv-jobs-list');
  private readonly empty = q(this.root, '.cv-jobs-empty');
  private readonly count = q(this.root, '.cv-jobs-count');
  private frame = 0;

  constructor(private readonly store: WorkspaceStore, private readonly anchor: HTMLElement) {
    document.getElementById('overlay-root')?.appendChild(this.root);
    this.words();
    store.on('jobs', () => this.queue());
    onLanguage(() => { this.words(); this.sync(); });
    this.list.addEventListener('click', (e) => {
      const row = e.target instanceof Element && e.target.closest('.cv-jobs-stop') ? e.target.closest<HTMLElement>('[data-job]') : null;
      const id = row?.dataset.job;
      if (id) this.store.jobs.find((j) => j.id === id)?.cancel?.();
    });
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.hide(); } });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(): void { if (this.isOpen) this.hide(); else this.show(); }

  show(): void {
    if (this.isOpen) return;
    const r = this.anchor.getBoundingClientRect();
    this.root.hidden = false;
    this.root.style.left = `${Math.max(8, Math.min(window.innerWidth - 8 - this.root.offsetWidth, r.right - this.root.offsetWidth - 8))}px`;
    this.root.style.bottom = `${Math.max(8, Math.min(window.innerHeight - 48, window.innerHeight - r.top + 6))}px`;
    this.sync();
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.escape, true);
  }

  hide(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.escape, true);
  }

  private readonly escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); this.hide(); }
  };

  private readonly outside = (e: PointerEvent): void => {
    if (e.target instanceof Node && !this.root.contains(e.target) && !this.anchor.contains(e.target)) this.hide();
  };

  private words(): void {
    setText(q(this.root, '.cv-jobs-title'), t('Jobs'));
    this.root.setAttribute('aria-label', t('Jobs'));
    setText(this.empty, t('No background jobs are running.'));
  }

  private queue(): void {
    if (!this.isOpen || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.sync(); });
  }

  private sync(): void {
    if (!this.isOpen) return;
    const jobs = this.store.jobs.filter((j) => !j.done);
    patchList<Job>(this.list, jobs, {
      key: (j) => j.id,
      create: (j) => {
        const row = el('<div class="cv-jobs-row" role="listitem"><span class="cv-jobs-name"></span><span class="cv-jobs-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></span><span class="cv-jobs-pct"></span><button class="cv-jobs-stop" type="button" hidden></button></div>');
        row.dataset.job = j.id;
        this.fill(row, j);
        return row;
      },
      update: (row, j) => this.fill(row, j),
    });
    setHidden(this.empty, jobs.length > 0);
    setText(this.count, jobs.length ? String(jobs.length) : '');
  }

  private fill(row: HTMLElement, j: Job): void {
    const name = q(row, '.cv-jobs-name'), bar = q(row, '.cv-jobs-bar'), btn = q<HTMLButtonElement>(row, '.cv-jobs-stop');
    const known = j.progress >= 0;
    const pct = known ? Math.round(Math.min(1, j.progress) * 100) : 0;
    setText(name, j.label);
    setTitle(name, j.label);
    setStyleVar(bar, '--p', `${pct}%`);
    if (bar.getAttribute('aria-valuenow') !== String(pct)) bar.setAttribute('aria-valuenow', String(pct));
    setText(q(row, '.cv-jobs-pct'), known ? `${pct}%` : '');
    setText(btn, t('Stop'));
    setTitle(btn, `${t('Stop')}: ${j.label}`);
    setHidden(btn, !j.cancel);
  }
}
