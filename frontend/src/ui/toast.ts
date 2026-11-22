import { el } from './dom';
import { icon } from './icons';
import { t } from './i18n';
import { loadPrefs } from './prefs';

const timers = new WeakMap<Element, number>();
const pointer = { x: -1e4, y: -1e4, onStage: false, frame: 0, watching: false };

function clearOfPointer(root: HTMLElement): void {
  pointer.frame = 0;
  for (const n of Array.from(root.children)) {
    const r = n.getBoundingClientRect(), near = pointer.onStage && pointer.x >= r.left - 24 && pointer.x <= r.right + 24 && pointer.y >= r.top - 24 && pointer.y <= r.bottom + 24;
    if (n.classList.contains('is-away') !== near) n.classList.toggle('is-away', near);
  }
}

export interface NoticeAction { label: string; run: () => void }
export interface NoticeOptions { actions?: NoticeAction[]; ms?: number; key?: string }
export interface NoticeRecord { id: number; text: string; kind: 'info' | 'error'; at: number; count: number }

const HISTORY_MAX = 100;
const history: NoticeRecord[] = [];
const watchers = new Set<() => void>();
const actionsOf = new WeakMap<Element, NoticeAction[]>();
let nextId = 1;

export const noticeHistory = (): readonly NoticeRecord[] => history;
export function clearNoticeHistory(): void { history.length = 0; for (const w of watchers) w(); }
export function onNoticeHistory(fn: () => void): () => void { watchers.add(fn); return () => watchers.delete(fn); }

function record(text: string, kind: 'info' | 'error'): void {
  const last = history[history.length - 1];
  if (last && last.text === text && last.kind === kind) {
    last.count++;
    last.at = Date.now();
  } else {
    history.push({ id: nextId++, text, kind, at: Date.now(), count: 1 });
    if (history.length > HISTORY_MAX) history.shift();
  }
  for (const w of watchers) w();
}

const VISIBLE_MAX = 4;

function stack(root: HTMLElement, fresh?: HTMLElement): void {
  const gap = parseFloat(getComputedStyle(root).rowGap) || 0;
  let y = 0;
  for (let i = root.children.length - 1; i >= 0; i--) {
    const n = root.children[i] as HTMLElement;
    if (n.classList.contains('is-leaving')) continue;
    const h = n.offsetHeight;
    if (n === fresh) {
      n.style.transition = 'none';
      n.style.transform = `translateY(${gap - y}px)`;
      n.getBoundingClientRect();
      n.style.transition = '';
      n.classList.add('is-in');
    }
    n.dataset.y = String(y);
    n.style.transform = `translateY(${-y}px)`;
    y += h + gap;
  }
}

function leave(node: HTMLElement): void {
  window.clearTimeout(timers.get(node));
  const root = node.parentElement;
  if (!root || node.classList.contains('is-leaving')) return;
  const gap = parseFloat(getComputedStyle(root).rowGap) || 0;
  node.classList.add('is-leaving');
  node.style.transform = `translateY(${gap - Number(node.dataset.y || 0)}px)`;
  const s = getComputedStyle(node).transitionDuration.split(',').map((d) => parseFloat(d) || 0);
  timers.set(node, window.setTimeout(() => node.remove(), Math.max(0, ...s) * 1000 + 30));
  stack(root as HTMLElement);
}

function syncActions(node: HTMLElement, actions: NoticeAction[]): void {
  const bar = node.querySelector('.cv-toast-actions')!;
  if (actions.length) actionsOf.set(node, actions); else actionsOf.delete(node);
  while (bar.children.length > actions.length) bar.lastElementChild?.remove();
  actions.forEach((a, i) => {
    let b = bar.children[i] as HTMLElement | undefined;
    if (!b) { b = el('<button class="cv-toast-action" type="button"></button>'); bar.append(b); }
    b.dataset.at = String(i);
    if (b.textContent !== a.label) b.textContent = a.label;
  });
}

function watchPointer(root: HTMLElement): void {
  if (pointer.watching) return;
  pointer.watching = true;
  root.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null, node = target?.closest<HTMLElement>('.cv-toast');
    if (!node) return;
    if (target?.closest('.cv-toast-close')) { leave(node); return; }
    const act = target?.closest<HTMLElement>('.cv-toast-action');
    if (!act) return;
    const run = actionsOf.get(node)?.[Number(act.dataset.at)];
    leave(node);
    run?.run();
  });
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.onStage = e.target instanceof Element && !!e.target.closest('.cv-stage');
    if (!pointer.frame) pointer.frame = requestAnimationFrame(() => clearOfPointer(root));
  }, { passive: true });
}

export function toast(text: string, kind: 'info' | 'error' = 'info', opts: NoticeOptions = {}): () => void {
  record(text, kind);
  const root = document.getElementById('toast-root');
  if (!root) return () => undefined;
  watchPointer(root);
  const actions = opts.actions ?? [], ms = opts.ms ?? (actions.length ? 10000 : loadPrefs().noticeSeconds * 1000 || (kind === 'error' ? 6000 : 3600)), cls = `cv-toast${kind === 'error' ? ' is-error' : ''}`;
  const key = opts.key ?? (actions.length ? '' : text);
  const arm = (n: HTMLElement): void => { window.clearTimeout(timers.get(n)); if (ms > 0) timers.set(n, window.setTimeout(() => leave(n), ms)); };
  const same = key ? (Array.from(root.children) as HTMLElement[]).find((n) => n.dataset.key === key && !n.classList.contains('is-leaving')) : undefined;
  if (same) {
    const textEl = same.firstElementChild!;
    if (textEl.textContent !== text) textEl.textContent = text;
    same.classList.toggle('is-error', kind === 'error');
    same.dataset.text = text;
    syncActions(same, actions);
    arm(same);
    stack(root);
    return () => leave(same);
  }
  const node = el(`<div class="${cls}" role="status"><span class="cv-toast-text"></span><span class="cv-toast-actions"></span><button class="cv-toast-close" type="button" title="${t('Dismiss')}" aria-label="${t('Dismiss notice')}">${icon('close', 12)}</button></div>`);
  node.dataset.text = text;
  if (key) node.dataset.key = key;
  node.firstElementChild!.textContent = text;
  syncActions(node, actions);
  root.append(node);
  const live = (Array.from(root.children) as HTMLElement[]).filter((n) => !n.classList.contains('is-leaving'));
  for (const old of live.slice(0, Math.max(0, live.length - VISIBLE_MAX))) leave(old);
  stack(root, node);
  clearOfPointer(root);
  arm(node);
  return () => leave(node);
}
