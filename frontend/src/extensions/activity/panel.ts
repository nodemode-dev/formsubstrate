import { library, type ActivityEvent } from '../../io/library';
import { el, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { onLanguage, t, tn } from '../../ui/i18n';

export const RUN_EVENT = 'subform:run-event';
export const RUN_STARTED = 'subform:run-started';

export const PHASES = ['enter', 'exit', 'tool', 'output', 'delta', 'skills', 'loop', 'yielded', 'halt', 'error', 'compaction'] as const;

const POLL_MS = 2000;
const MAX_ROWS = 300;
const STREAM_KEEP = 400;

export interface RunEvent {
  seq?: number;
  label: string;
  phase: string;
  note?: string | null;
  source?: string;
}

export class ActivityPanel {
  private readonly filters: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly count: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly off = new Set<string>();
  private readonly chips = new Map<string, HTMLButtonElement>();
  private last = 0;
  private rows = 0;
  private streamRow: HTMLElement | null = null;
  private streamLabel = '';
  private streamText = '';
  private timer = 0;

  constructor(private readonly host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib cv-act">' +
      `<div class="cv-lib-bar"><span class="cv-lib-count"></span><button class="cv-wb-tool cv-act-clear" type="button">${icon('delete', 14)}</button></div>` +
      '<div class="cv-act-filters" role="group"></div>' +
      '<div class="cv-act-feed" role="log" aria-live="off"><p class="cv-note cv-act-empty"></p></div></div>'));
    this.filters = q(host, '.cv-act-filters');
    this.feed = q(host, '.cv-act-feed');
    this.empty = q(host, '.cv-act-empty');
    this.count = q(host, '.cv-lib-count');
    this.clearBtn = q(host, '.cv-act-clear');
    for (const phase of PHASES) {
      const chip = el<HTMLButtonElement>(`<button class="cv-act-chip is-on" type="button" data-p="${phase}"></button>`);
      this.chips.set(phase, chip);
      this.filters.append(chip);
    }
    this.filters.addEventListener('click', (e) => {
      const chip = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.cv-act-chip') : null;
      if (chip?.dataset.p) this.flip(chip.dataset.p);
    });
    this.clearBtn.addEventListener('click', () => void this.clear());
    window.addEventListener(RUN_EVENT, (e) => this.take((e as CustomEvent<RunEvent>).detail, true));
    window.addEventListener(RUN_STARTED, () => this.wipe());
    onLanguage(() => this.relabel());
    this.relabel();
    this.timer = window.setInterval(() => { if (this.host.offsetParent !== null && !document.hidden) void this.poll(); }, POLL_MS);
    void this.poll();
  }

  private relabel(): void {
    for (const [phase, chip] of this.chips) setText(chip, t(phase));
    setText(this.empty, t('No events yet'));
    setTitle(this.clearBtn, t('Clear'));
    this.clearBtn.setAttribute('aria-label', t('Clear'));
    this.paintCount();
  }

  private paintCount(): void {
    setText(this.count, tn(this.rows, '{n} event', '{n} events'));
  }

  private flip(phase: string): void {
    const hide = !this.off.has(phase);
    if (hide) this.off.add(phase);
    else this.off.delete(phase);
    const chip = this.chips.get(phase);
    if (chip) setClass(chip, 'is-on', !hide);
    for (const row of Array.from(this.feed.querySelectorAll<HTMLElement>(`.cv-act-row[data-p="${phase}"]`))) setHidden(row, hide);
  }

  private async poll(): Promise<void> {
    try {
      const d = await library.activity(this.last);
      if (d.last < this.last) {
        this.wipe();
        this.last = 0;
        return;
      }
      for (const ev of d.events) this.take(ev, false);
      this.last = d.last;
    } catch {
      return;
    }
  }

  private async clear(): Promise<void> {
    try { await library.clearActivity(); } catch { return; }
    this.wipe();
  }

  private wipe(): void {
    for (const row of Array.from(this.feed.querySelectorAll('.cv-act-row'))) row.remove();
    this.rows = 0;
    this.streamRow = null;
    setHidden(this.empty, false);
    this.paintCount();
  }

  take(ev: RunEvent | ActivityEvent, live: boolean): void {
    if (!ev || typeof ev.label !== 'string') return;
    const stick = this.feed.scrollTop + this.feed.clientHeight >= this.feed.scrollHeight - 8;
    setHidden(this.empty, true);
    if (ev.phase === 'delta') {
      if (!this.streamRow || this.streamLabel !== ev.label) {
        this.streamText = '';
        this.streamLabel = ev.label;
        this.streamRow = this.row(ev, 'stream', '');
        this.add(this.streamRow);
      }
      this.streamText = (this.streamText + (ev.note ?? '')).slice(-STREAM_KEEP);
      setText(q(this.streamRow, '.cv-act-note'), this.streamText);
    } else {
      this.streamRow = null;
      const stamp = 'ts' in ev && typeof ev.ts === 'number' ? new Date(ev.ts * 1000) : new Date();
      this.add(this.row(ev, ev.phase, stamp.toTimeString().slice(0, 8)));
    }
    if (stick || live) this.feed.scrollTop = this.feed.scrollHeight;
  }

  private row(ev: RunEvent | ActivityEvent, chip: string, stamp: string): HTMLElement {
    const node = el(`<div class="cv-act-row" data-p="${ev.phase}" role="article"><span class="cv-act-ts"></span><span class="cv-act-pc"></span><b class="cv-act-label"></b><div class="cv-act-note"></div></div>`);
    setText(q(node, '.cv-act-ts'), stamp);
    setText(q(node, '.cv-act-pc'), t(chip));
    setText(q(node, '.cv-act-label'), ev.label);
    setText(q(node, '.cv-act-note'), ev.note ? ev.note.slice(0, 220) : '');
    setHidden(q(node, '.cv-act-note'), !ev.note && ev.phase !== 'delta');
    setHidden(node, this.off.has(ev.phase));
    return node;
  }

  private add(node: HTMLElement): void {
    this.feed.append(node);
    this.rows += 1;
    while (this.feed.querySelectorAll('.cv-act-row').length > MAX_ROWS) {
      this.feed.querySelector('.cv-act-row')?.remove();
      this.rows -= 1;
    }
    this.paintCount();
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
