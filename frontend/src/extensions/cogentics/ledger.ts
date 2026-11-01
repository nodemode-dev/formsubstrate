import type { Msg } from '../../io/cogentics';
import { el, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { t, tn } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { fmtTok, paintDiff, paintRich } from './rich';

const STALL_MS = 30 * 60 * 1000;
const STICK_PX = 48;

interface Row {
  node: HTMLElement;
  msg: Msg;
  stream: Text | null;
  last: number;
  tools: number;
  built: string;
}

export interface LedgerHooks {
  handles(): Set<string>;
  decide(seq: number, approved: boolean): void;
  openNote(name: string): void;
  openChanges(scope: string): void;
  scopeOf(seq: number): string;
}

const timeOf = (ts: number): string => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export class Ledger {
  readonly root: HTMLElement;
  private readonly rows = new Map<number, Row>();
  private timer = 0;

  constructor(host: HTMLElement, private readonly hooks: LedgerHooks) {
    this.root = host;
    host.addEventListener('click', (e) => this.onClick(e));
  }

  get size(): number {
    return this.rows.size;
  }

  clear(): void {
    for (const r of this.rows.values()) r.node.remove();
    this.rows.clear();
    this.stopClock();
  }

  messages(): Msg[] {
    return [...this.rows.values()].map((r) => r.msg).sort((a, b) => a.seq - b.seq);
  }

  find(seq: number): Msg | undefined {
    return this.rows.get(seq)?.msg;
  }

  private stuck(): boolean {
    const r = this.root;
    return r.scrollHeight - r.scrollTop - r.clientHeight < STICK_PX;
  }

  private follow(was: boolean): void {
    if (was) this.root.scrollTop = this.root.scrollHeight;
  }

  private build(m: Msg): Row {
    const node = el<HTMLElement>(`<div class="cx-msg" data-seq="${m.seq}">
<div class="cx-msg-head"><span class="cx-author"></span><span class="cx-seqno"></span><span class="cx-chip cx-grp" hidden></span><span class="cx-chip cx-sim" hidden>${t('simulated')}</span><span class="cx-chip cx-unres" hidden></span><span class="cx-when"></span><span class="cx-elapsed" hidden></span><span class="cx-chip cx-stall" hidden>${t('stalled')}</span><span class="cx-spin" hidden>${icon('refresh', 11)}</span></div>
<div class="cx-cont-tag" hidden>${t('continuation of')} <button type="button" class="cx-ref"></button></div>
<div class="cx-card" hidden><div class="cx-card-head">${icon('shield', 12)}<span class="cx-card-who"></span><code class="cx-card-tool"></code><span class="cx-card-verdict" hidden></span></div><pre class="cx-card-pre"></pre><div class="cx-card-actions"><button type="button" class="cv-btn cv-btn-primary" data-decide="1">${t('Allow')}</button><button type="button" class="cv-btn" data-decide="0">${t('Deny')}</button></div></div>
<div class="cx-toolwrap" hidden><button type="button" class="cx-tooltoggle"></button><div class="cx-tools"></div></div>
<div class="cx-body"></div>
<div class="cx-facts" hidden></div>
<div class="cx-acts" hidden><button type="button" class="cv-btn cx-changes">${icon('diff', 12)}<span>${t('Changes')}</span></button></div>
</div>`);
    node.querySelector('.cx-tooltoggle')?.addEventListener('click', () => setClass(node, 'cx-open', !node.classList.contains('cx-open')));
    return { node, msg: m, stream: null, last: Date.now(), tools: 0, built: '' };
  }

  upsert(m: Msg): void {
    let row = this.rows.get(m.seq);
    const was = this.stuck();
    if (!row) {
      row = this.build(m);
      this.rows.set(m.seq, row);
      this.root.append(row.node);
    }
    row.msg = m;
    this.paint(row);
    this.follow(was);
  }

  private paint(row: Row): void {
    const { node, msg: m } = row;
    const isCard = m.kind === 'approval';
    const running = m.kind === 'run' && m.status === 'running';
    const final = m.kind === 'run' && m.status === 'final';
    const handles = this.hooks.handles();
    setClass(node, `cx-${m.kind}`, true);
    setClass(node, 'cx-me', m.author === 'operator');
    setClass(node, 'cx-cont', !!m.run_parent);
    setText(q(node, '.cx-author'), `@${m.author}`);
    setText(q(node, '.cx-seqno'), `#${m.seq}`);
    setText(q(node, '.cx-when'), timeOf(m.ts));
    const grp = q(node, '.cx-grp');
    setHidden(grp, !m.group);
    setText(grp, `${t('group')} r${m.round || 1}`);
    setTitle(grp, m.group ? `${t('collaboration group')} ${m.group}` : '');
    setHidden(q(node, '.cx-sim'), !m.simulated);
    const unres = q(node, '.cx-unres');
    const nu = m.unresolved?.length ?? 0;
    setHidden(unres, nu === 0);
    setText(unres, String(nu));
    setTitle(unres, nu ? `${t('unresolved')}: ${(m.unresolved ?? []).map((h) => `@${h}`).join(' ')}` : '');
    const cont = q(node, '.cx-cont-tag');
    setHidden(cont, !m.run_parent);
    const contBtn = q(cont, '.cx-ref');
    setText(contBtn, `#${m.run_parent ?? ''}`);
    contBtn.dataset.jump = String(m.run_parent ?? '');
    setHidden(q(node, '.cx-spin'), !running);
    const elapsed = q(node, '.cx-elapsed');
    setHidden(elapsed, !running);
    elapsed.dataset.started = String(m.ts);
    if (!running) setHidden(q(node, '.cx-stall'), true);
    if (running) {
      setClass(node, 'cx-open', true);
      setHidden(q(node, '.cx-toolwrap'), false);
      this.startClock();
    }
    this.paintCard(row, isCard);
    this.paintBody(row, running, final);
    const facts = q(node, '.cx-facts');
    const f = final && !m.error && !m.ack ? this.facts(m) : '';
    setHidden(facts, !f);
    setText(facts, f);
    const acts = q(node, '.cx-acts');
    const showChanges = final && !!m.tools && !m.ack && !m.error;
    setHidden(acts, !showChanges);
    if (final) {
      setClass(node, 'cx-open', false);
      const n = row.tools;
      const wrap = q(node, '.cx-toolwrap');
      setHidden(wrap, n === 0);
      setText(q(node, '.cx-tooltoggle'), tn(n, '{n} tool call', '{n} tool calls'));
    }
  }

  private paintBody(row: Row, running: boolean, final: boolean): void {
    const { node, msg: m } = row;
    const body = q(node, '.cx-body');
    setClass(node, 'cx-ack', !!(final && m.ack));
    setClass(node, 'cx-failed', !!(final && m.error));
    if (m.kind === 'approval') { setHidden(body, true); return; }
    setHidden(body, false);
    if (running && !row.stream) {
      if (row.built !== 'run') { row.built = 'run'; body.textContent = '…'; }
      return;
    }
    if (running) return;
    if (final && m.ack) {
      this.fixed(row, body, `ack:${m.author}`, () => {
        const s = document.createElement('span');
        s.className = 'cx-ack-line';
        s.insertAdjacentHTML('afterbegin', icon('check', 11));
        s.append(`@${m.author} ${t('acknowledged')}`);
        return s;
      });
      return;
    }
    if (final && m.error) {
      this.fixed(row, body, `err:${m.error}`, () => {
        const s = document.createElement('span');
        s.className = 'cx-error';
        s.textContent = `${t('turn failed')} · ${t('evidence')}: ${m.error}`;
        return s;
      });
      return;
    }
    if (final && m.continued_to) {
      this.fixed(row, body, `cont:${m.continued_to}`, () => {
        const s = document.createElement('span');
        s.className = 'cx-continued';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cx-ref';
        b.dataset.jump = String(m.continued_to);
        b.textContent = `#${m.continued_to}`;
        s.append(`${t('continued in')} `, b, ` (${t('messages landed while this turn ran')})`);
        return s;
      });
      return;
    }
    if (final && !m.body) {
      this.fixed(row, body, 'empty', () => {
        const s = document.createElement('span');
        s.className = 'cx-empty-run';
        s.textContent = `(${t('empty turn')})`;
        return s;
      });
      return;
    }
    if (row.stream && body.dataset.rich === undefined && row.stream.data === m.body) {
      row.built = 'rich';
      body.dataset.rich = `${m.body.length}:${m.body}`;
      row.stream = null;
      paintRich(body, m.body, this.hooks.handles());
      return;
    }
    row.stream = null;
    row.built = 'rich';
    paintRich(body, m.body, this.hooks.handles());
  }

  private fixed(row: Row, body: HTMLElement, key: string, make: () => Node): void {
    if (row.built === key) return;
    row.built = key;
    delete body.dataset.rich;
    row.stream = null;
    body.replaceChildren(make());
  }

  private paintCard(row: Row, isCard: boolean): void {
    const { node, msg: m } = row;
    const card = q(node, '.cx-card');
    setHidden(card, !isCard);
    if (!isCard || !m.card) return;
    const open = m.status === 'open';
    setClass(card, 'is-open', open);
    setText(q(card, '.cx-card-who'), `@${m.author}`);
    setText(q(card, '.cx-card-tool'), m.card.tool);
    paintDiff(q(card, '.cx-card-pre'), m.card.diff ?? m.card.args);
    setHidden(q(card, '.cx-card-actions'), !open);
    const verdict = q(card, '.cx-card-verdict');
    setHidden(verdict, !m.answer);
    if (m.answer) {
      setText(verdict, `${m.answer.approved ? t('allowed') : t('denied')} · ${m.answer.by}`);
      setClass(verdict, 'ok', m.answer.approved);
      setClass(verdict, 'no', !m.answer.approved);
    }
  }

  private facts(m: Msg): string {
    const bits: string[] = [];
    if (m.tools) bits.push(tn(m.tools, '{n} tool', '{n} tools'));
    const u = m.usage;
    if (u && (u.prompt || u.completion)) {
      bits.push(`${fmtTok(u.prompt + u.completion)} tok`);
      if (u.cost) bits.push(`$${u.cost.toFixed(4)}`);
    }
    if (m.ms) bits.push(`${(m.ms / 1000).toFixed(1)}s`);
    return bits.join(' · ');
  }

  delta(seq: number, text: string): void {
    const row = this.rows.get(seq);
    if (!row) return;
    const was = this.stuck();
    const body = q(row.node, '.cx-body');
    if (!row.stream) {
      delete body.dataset.rich;
      row.stream = document.createTextNode('');
      body.replaceChildren(row.stream);
    }
    row.stream.data += text;
    row.last = Date.now();
    this.follow(was);
  }

  tool(seq: number, note: string): void {
    const row = this.rows.get(seq);
    if (!row) return;
    const was = this.stuck();
    const n = document.createElement('div');
    n.className = 'cx-tool-note';
    n.textContent = note;
    q(row.node, '.cx-tools').append(n);
    row.tools += 1;
    row.last = Date.now();
    setHidden(q(row.node, '.cx-toolwrap'), false);
    setText(q(row.node, '.cx-tooltoggle'), tn(row.tools, '{n} tool call', '{n} tool calls'));
    this.follow(was);
  }

  touch(seq: number): void {
    const row = this.rows.get(seq);
    if (row) row.last = Date.now();
  }

  jump(seq: number): void {
    const row = this.rows.get(seq);
    if (!row) return;
    row.node.scrollIntoView({ block: 'center' });
    setClass(row.node, 'cx-flash', true);
    window.setTimeout(() => setClass(row.node, 'cx-flash', false), 1200);
  }

  defaultRecipient(workers: Set<string>): string {
    const list = this.messages();
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.kind !== 'run' || m.status !== 'final' || m.ack || m.continued_to) continue;
      if (!m.body) continue;
      if (workers.has(m.author)) return m.author;
    }
    return '';
  }

  private onClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const jump = target.closest<HTMLElement>('[data-jump]');
    if (jump?.dataset.jump) { this.jump(Number(jump.dataset.jump)); return; }
    const note = target.closest<HTMLElement>('[data-note]');
    if (note?.dataset.note) { this.hooks.openNote(note.dataset.note); return; }
    const decide = target.closest<HTMLElement>('[data-decide]');
    const msg = target.closest<HTMLElement>('.cx-msg');
    if (decide && msg) { this.hooks.decide(Number(msg.dataset.seq), decide.dataset.decide === '1'); return; }
    if (target.closest('.cx-changes') && msg) this.hooks.openChanges(this.hooks.scopeOf(Number(msg.dataset.seq)));
  }

  private startClock(): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private stopClock(): void {
    if (!this.timer) return;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private tick(): void {
    const now = Date.now();
    let any = false;
    for (const row of this.rows.values()) {
      if (row.msg.kind !== 'run' || row.msg.status !== 'running') continue;
      any = true;
      const s = Math.max(0, Math.round((now - row.msg.ts * 1000) / 1000));
      setText(q(row.node, '.cx-elapsed'), `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      setHidden(q(row.node, '.cx-stall'), now - row.last < STALL_MS);
    }
    if (!any) this.stopClock();
  }
}
