import type { CatalogGroup, Member } from '../../io/cogentics';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { fmtTok } from './rich';

export interface Live { state?: string; depth?: number; held?: number }
export interface Spent { tok: number; cost: number }

export interface RailHooks {
  toggle(m: Member): void;
  remove(m: Member): void;
  release(m: Member): void;
}

const isWorker = (m: Member): boolean => m.kind === 'agent' || m.kind === 'claude';

export class MemberRail {
  private members: Member[] = [];
  private readonly live = new Map<string, Live>();
  private readonly spend = new Map<string, Spent>();

  constructor(private readonly host: HTMLElement, private readonly hooks: RailHooks) {}

  set(members: Member[]): void {
    this.members = members;
    this.paint();
  }

  setLive(handle: string, live: Live): void {
    this.live.set(handle, { ...this.live.get(handle), ...live });
    this.paint();
  }

  setSpend(map: Map<string, Spent>): void {
    this.spend.clear();
    for (const [k, v] of map) this.spend.set(k, v);
    this.paint();
  }

  addSpend(handle: string, tok: number, cost: number): void {
    const cur = this.spend.get(handle) ?? { tok: 0, cost: 0 };
    this.spend.set(handle, { tok: cur.tok + tok, cost: cur.cost + cost });
    this.paint();
  }

  private label(m: Member): string {
    const live = this.live.get(m.handle);
    const held = live?.held ?? m.held?.length ?? 0;
    if (held) return `${t('held')} ${held}`;
    const st = live?.state ?? (m.state === 'active' ? 'idle' : m.state);
    if (st === 'queued') return `${t('queued')} ${live?.depth ?? ''}`.trim();
    if (st === 'awaiting_input') return t('awaiting input');
    return t(st);
  }

  private paint(): void {
    patchList(this.host, this.members, {
      key: (m) => m.handle,
      create: (m) => {
        const row = el<HTMLElement>(`<div class="cx-member">
<div class="cx-member-top"><span class="cx-dot"></span><span class="cx-mh"></span><span class="cx-mstate"></span><button type="button" class="cv-tt-btn cx-mini" data-act="toggle"></button><button type="button" class="cv-tt-btn cx-mini" data-act="del" title="${t('Remove member')}" aria-label="${t('Remove member')}">${icon('close', 11)}</button></div>
<div class="cx-member-sub"><span class="cx-mk"></span><span class="cx-policy"></span><span class="cx-mspend"></span><button type="button" class="cv-btn cx-release" data-act="release">${t('Release')}</button></div></div>`);
        row.addEventListener('click', (e) => {
          const act = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]')?.dataset.act : undefined;
          const cur = this.members.find((x) => x.handle === row.dataset.key);
          if (!act || !cur) return;
          if (act === 'toggle') this.hooks.toggle(cur);
          else if (act === 'del') this.hooks.remove(cur);
          else if (act === 'release') this.hooks.release(cur);
        });
        return row;
      },
      update: (row, m) => {
        const worker = isWorker(m);
        const live = this.live.get(m.handle);
        setClass(q(row, '.cx-dot'), 'on', m.state === 'active');
        setClass(q(row, '.cx-dot'), 'run', live?.state === 'running');
        setClass(q(row, '.cx-dot'), 'queue', live?.state === 'queued');
        setClass(q(row, '.cx-dot'), 'wait', live?.state === 'awaiting_input');
        const mh = q(row, '.cx-mh');
        setText(mh, `@${m.handle}`);
        setTitle(mh, m.role_prompt || m.kind);
        setText(q(row, '.cx-mstate'), this.label(m));
        const toggle = q<HTMLButtonElement>(row, '[data-act="toggle"]');
        setHidden(toggle, !worker);
        const active = m.state === 'active';
        const tip = active ? t('Pause (queues deliveries)') : t('Revive (runs queued work)');
        setTitle(toggle, tip);
        if (toggle.getAttribute('aria-label') !== tip) toggle.setAttribute('aria-label', tip);
        const want = active ? 'minus' : 'play';
        if (toggle.dataset.icon !== want) {
          toggle.dataset.icon = want;
          toggle.innerHTML = icon(want, 11);
        }
        setHidden(q(row, '[data-act="del"]'), !worker);
        const model = m.model ? (m.model.split('/').pop() ?? '').slice(0, 16) : '';
        setText(q(row, '.cx-mk'), `${m.kind === 'human' ? t('human') : m.kind === 'claude' ? t('cli') : t('api')}${model ? ` · ${model}` : ''}`);
        const policy = !worker ? '' : m.kind === 'claude' ? (m.full_access ? t('full access') : t('accept edits')) : t('workspace tools');
        setText(q(row, '.cx-policy'), policy);
        const sp = this.spend.get(m.handle);
        setText(q(row, '.cx-mspend'), sp && sp.tok ? `${fmtTok(sp.tok)} tok${sp.cost ? ` · $${sp.cost.toFixed(3)}` : ''}` : '');
        const held = live?.held ?? m.held?.length ?? 0;
        setHidden(q(row, '[data-act="release"]'), held === 0);
      },
    });
  }
}

export function fillModels(select: HTMLSelectElement, groups: CatalogGroup[] | null, cli: Array<{ id: string; label: string }> | null, kind: string): void {
  const want = kind === 'claude' ? 'cli' : 'api';
  if (select.dataset.filled === `${want}:${groups ? groups.length : 0}:${cli ? cli.length : 0}`) return;
  select.dataset.filled = `${want}:${groups ? groups.length : 0}:${cli ? cli.length : 0}`;
  const nodes: Node[] = [];
  const opt = (v: string, label: string): HTMLOptionElement => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    return o;
  };
  if (want === 'cli') {
    for (const m of cli ?? [{ id: '', label: t('CLI default model') }]) nodes.push(opt(m.id, m.label));
  } else {
    nodes.push(opt('', t('Provider default model')));
    for (const g of groups ?? []) {
      const og = document.createElement('optgroup');
      og.label = g.vendor;
      for (const m of g.models) og.append(opt(m.id, m.label));
      nodes.push(og);
    }
  }
  select.replaceChildren(...nodes);
  select.value = '';
}
