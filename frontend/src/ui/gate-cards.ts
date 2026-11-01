import type { Gate, GateChoice } from '../io/formslot';
import { compact } from '../io/formslot';
import { sessionsClient } from '../io/sessions';
import { detailOf, statusOf } from '../io/workspace';
import { el, patchList, q, setDisabled, setHidden, setText, setTitle } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';
import { toast } from './toast';

const MAX_CARDS = 3;
const MAX_SLOTS = 3;

export const CHOICES: ReadonlyArray<readonly [GateChoice, string, string]> = [
  ['use', 'Use', 'Tell the agent to reuse the existing slot'],
  ['adapt', 'Adapt', 'Tell the agent to adapt the existing slot instead of writing a parallel copy'],
  ['write', 'Write new anyway', 'Let the write go ahead'],
];

export async function answerOpenGate(id: string, choice: GateChoice): Promise<string> {
  try {
    await sessionsClient.answerGate(id, choice);
    return '';
  } catch (err) {
    if (statusOf(err) === 404 || statusOf(err) === 410) {
      sessionsClient.closeGate(id);
      return '';
    }
    const detail = detailOf(err);
    toast(detail, 'error');
    return detail;
  }
}

export class GateCards {
  readonly root = el<HTMLElement>(`<div class="cv-gates" id="gate-root" role="region" aria-live="polite"><div class="cv-gates-more" hidden></div><div class="cv-gates-list"></div></div>`);
  private readonly list = q(this.root, '.cv-gates-list');
  private readonly more = q(this.root, '.cv-gates-more');
  private readonly busy = new Set<string>();
  private readonly failed = new Map<string, string>();
  private outside: HTMLElement | null = null;
  private frame = 0;

  constructor() {
    document.body.append(this.root);
    this.root.addEventListener('mousedown', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.cv-gate-btn')) e.preventDefault();
    });
    this.root.addEventListener('focusin', (e) => {
      const from = (e as FocusEvent).relatedTarget;
      if (from instanceof HTMLElement && !this.root.contains(from)) this.outside = from;
    });
    this.root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const btn = target?.closest<HTMLButtonElement>('.cv-gate-btn');
      const id = btn?.closest<HTMLElement>('.cv-gate')?.dataset.key;
      const choice = btn?.dataset.choice;
      if (btn && id && (choice === 'use' || choice === 'adapt' || choice === 'write')) void this.answer(id, choice);
    });
    sessionsClient.on('gates', () => this.schedule());
    sessionsClient.on('sessions', () => this.schedule());
    onLanguage(() => this.schedule());
    this.paint();
  }

  get count(): number { return sessionsClient.gates.length; }

  focusFirst(): void {
    const btn = this.list.querySelector<HTMLButtonElement>('.cv-gate:last-child .cv-gate-btn:not(:disabled)');
    btn?.focus();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private async answer(id: string, choice: GateChoice): Promise<void> {
    if (this.busy.has(id)) return;
    const node = this.list.querySelector<HTMLElement>(`.cv-gate[data-key="${CSS.escape(id)}"]`);
    const hadFocus = !!node && node.contains(document.activeElement);
    this.busy.add(id);
    this.failed.delete(id);
    this.paint();
    const failure = await answerOpenGate(id, choice);
    this.busy.delete(id);
    if (failure) this.failed.set(id, failure);
    this.paint();
    if (!failure && hadFocus) this.restoreFocus();
  }

  private restoreFocus(): void {
    const next = this.list.querySelector<HTMLButtonElement>('.cv-gate:last-child .cv-gate-btn:not(:disabled)');
    if (next) { next.focus(); return; }
    const back = this.outside;
    this.outside = null;
    if (back && back.isConnected) back.focus();
  }

  private paint(): void {
    const all = [...sessionsClient.gates].reverse();
    const shown = all.slice(all.length - Math.min(all.length, MAX_CARDS));
    patchList(this.list, shown, {
      key: (g) => g.id,
      create: (g) => this.create(g),
      update: (n, g) => this.update(n, g),
    });
    const hiddenCount = all.length - shown.length;
    setHidden(this.more, hiddenCount === 0);
    setText(this.more, hiddenCount > 0 ? `+${hiddenCount} ${t('more waiting')}` : '');
    setHidden(this.root, all.length === 0);
  }

  private create(g: Gate): HTMLElement {
    const n = el(`<section class="cv-gate" role="group">
<div class="cv-gate-head"><span class="cv-gate-mark">${icon('slot', 14)}</span><span class="cv-gate-title"></span><span class="cv-gate-session"></span></div>
<p class="cv-gate-msg"></p>
<div class="cv-gate-slots"></div>
<p class="cv-gate-err" hidden></p>
<div class="cv-gate-foot"><span class="cv-gate-tokens"></span><span class="cv-gate-btns">${CHOICES.map(([c]) => `<button class="cv-gate-btn${c === 'use' ? ' is-primary' : ''}" type="button" data-choice="${c}"></button>`).join('')}</span></div>
</section>`);
    this.update(n, g);
    return n;
  }

  private update(n: HTMLElement, g: Gate): void {
    const title = t('Existing slot found');
    setText(q(n, '.cv-gate-title'), title);
    if (n.getAttribute('aria-label') !== title) n.setAttribute('aria-label', title);
    const s = sessionsClient.get(g.session);
    const name = s?.title ?? g.session;
    setText(q(n, '.cv-gate-session'), name);
    setTitle(q(n, '.cv-gate-session'), name);
    setText(q(n, '.cv-gate-msg'), g.message || `${g.tool} ${g.path}`);
    setTitle(q(n, '.cv-gate-msg'), g.message);
    const rows = g.slots.slice(0, MAX_SLOTS).map((x) => ({ key: `${x.id}@${x.path}:${x.line}`, id: x.id, path: x.path, line: x.line }));
    if (g.slots.length > MAX_SLOTS) rows.push({ key: '+more', id: `+${g.slots.length - MAX_SLOTS}`, path: t('more'), line: 0 });
    patchList(q(n, '.cv-gate-slots'), rows, {
      key: (r) => r.key,
      create: (r) => {
        const row = el('<div class="cv-gate-slot"><span class="cv-gate-slot-id"></span><span class="cv-gate-slot-path"></span></div>');
        this.fillRow(row, r);
        return row;
      },
      update: (row, r) => this.fillRow(row, r),
    });
    setTitle(q(n, '.cv-gate-tokens'), g.tokens > 0 ? `${g.tokens.toLocaleString()} ${t('tokens saved if the agent reuses the slot')}` : '');
    setText(q(n, '.cv-gate-tokens'), g.tokens > 0 ? `${t('Saves')} ~${compact(g.tokens)} ${t('tokens')}` : '');
    const err = this.failed.get(g.id) ?? '';
    setText(q(n, '.cv-gate-err'), err);
    setHidden(q(n, '.cv-gate-err'), !err);
    const working = this.busy.has(g.id);
    for (const [c, label, tip] of CHOICES) {
      const b = q<HTMLButtonElement>(n, `[data-choice="${c}"]`);
      setText(b, t(label));
      setTitle(b, t(tip));
      setDisabled(b, working);
    }
  }

  private fillRow(row: HTMLElement, r: { id: string; path: string; line: number }): void {
    setText(q(row, '.cv-gate-slot-id'), r.id);
    const where = r.line > 0 ? `${r.path}:${r.line}` : r.path;
    setText(q(row, '.cv-gate-slot-path'), where);
    setTitle(row, `${r.id} ${where}`);
  }
}
