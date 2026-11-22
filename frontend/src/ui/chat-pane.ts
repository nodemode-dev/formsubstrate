import type { SessionsClient, TranscriptLine } from '../io/sessions';
import { el, q, setClass, setHidden, setText } from './dom';
import { onLanguage, t } from './i18n';
import { icon } from './icons';

const NEAR_BOTTOM_PX = 48;
const KEEP_LINES = 300;

const clock = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export class ChatPane {
  readonly root = el(`<div class="cv-chat">
<div class="cv-chat-head"><span class="cv-chat-title"></span><span class="cv-chat-kind cv-note"></span><button class="cv-chat-review" type="button" hidden>${icon('diff', 14)}<span class="cv-chat-review-t"></span></button></div>
<div class="cv-chat-log" role="log" aria-live="polite"><p class="cv-chat-empty cv-note"></p></div>
</div>`);
  private readonly title = q(this.root, '.cv-chat-title');
  private readonly kind = q(this.root, '.cv-chat-kind');
  private readonly log = q(this.root, '.cv-chat-log');
  private readonly empty = q(this.root, '.cv-chat-empty');
  private readonly reviewBtn = q<HTMLButtonElement>(this.root, '.cv-chat-review');
  private readonly streams = new Map<string, HTMLElement>();
  private current: { id: string; title: string; interactive: boolean } | null = null;

  constructor(private readonly client: SessionsClient) {
    client.on('line', (line) => this.append(line));
    client.on('sessions', (list) => {
      const live = new Set(list.map((s) => s.id));
      for (const [id, node] of this.streams) if (!live.has(id)) { node.remove(); this.streams.delete(id); }
      const c = this.current;
      if (!c) return;
      const s = list.find((x) => x.id === c.id);
      if (!s) { this.select(null); return; }
      if (s.title !== c.title) { c.title = s.title; setText(this.title, s.title); }
    });
    this.reviewBtn.addEventListener('click', () => {
      if (this.current) window.dispatchEvent(new CustomEvent('formsubstrate:open-review', { detail: { session: this.current.id } }));
    });
    onLanguage(() => this.paint());
    this.paint();
  }

  select(id: string | null): void {
    const s = id ? this.client.get(id) : undefined;
    this.current = s ? { id: s.id, title: s.title, interactive: s.mode === 'interactive' } : null;
    for (const [sid, node] of this.streams) setHidden(node, sid !== this.current?.id);
    if (s) this.stream(s.id);
    this.paint();
    if (s) this.log.scrollTop = this.log.scrollHeight;
  }

  private stream(id: string): HTMLElement {
    let node = this.streams.get(id);
    if (node) return node;
    node = el('<div class="cv-chat-stream" hidden></div>');
    this.streams.set(id, node);
    this.log.append(node);
    for (const line of this.client.transcript(id)) this.add(node, line);
    setHidden(node, this.current?.id !== id);
    return node;
  }

  private append(line: TranscriptLine): void {
    const node = this.streams.get(line.sessionId);
    if (!node) return;
    const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < NEAR_BOTTOM_PX;
    this.add(node, line);
    this.paint();
    if (stick && this.current?.id === line.sessionId) this.log.scrollTop = this.log.scrollHeight;
  }

  private add(stream: HTMLElement, line: TranscriptLine): void {
    const row = document.createElement('div');
    row.className = `cv-chat-line is-${line.kind}`;
    const time = document.createElement('span');
    time.className = 'cv-chat-time';
    time.textContent = clock(line.at);
    const text = document.createElement('span');
    text.className = 'cv-chat-text';
    text.textContent = line.kind === 'state' ? `${t('State')}: ${t(line.text)}` : line.text;
    row.append(time, text);
    stream.append(row);
    while (stream.childElementCount > KEEP_LINES) stream.firstElementChild?.remove();
  }

  private paint(): void {
    const c = this.current;
    const node = c ? this.streams.get(c.id) : undefined;
    setText(this.title, c?.title ?? t('Transcript'));
    setText(this.kind, c ? (c.interactive ? t('interactive') : t('headless')) : '');
    const none = !c || !node || node.childElementCount === 0;
    setHidden(this.empty, !none);
    setText(this.empty, !c ? t('Select a session to follow its messages.') : c.interactive ? t('Interactive session: the conversation is in its terminal.') : t('No messages yet.'));
    setClass(this.root, 'has-session', !!c);
    setHidden(this.reviewBtn, !c);
    setText(q(this.reviewBtn, '.cv-chat-review-t'), t('Review changes'));
  }
}
