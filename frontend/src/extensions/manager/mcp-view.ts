import { library, type McpRow } from '../../io/library';
import { confirmAction } from '../../ui/dialogs';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { onLanguage, t, tn } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { fail, setToggle, toggle, toolsChanged, type Toggle } from './parts';

interface Refs {
  dot: HTMLElement;
  name: HTMLElement;
  kind: HTMLElement;
  detail: HTMLElement;
  refresh: HTMLButtonElement;
  remove: HTMLButtonElement;
  tg: Toggle;
  row: McpRow;
}

const keyOf = (r: McpRow): string => `${r.origin}:${r.name}`;

export class McpView {
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly form: HTMLElement;
  private readonly refs = new WeakMap<HTMLElement, Refs>();
  private rows: McpRow[] = [];
  private busy = false;

  constructor(host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib-pane">' +
      `<div class="cv-lib-bar"><span class="cv-lib-count"></span><button class="cv-wb-tool cv-lib-refresh" type="button">${icon('refresh', 14)}</button><button class="cv-wb-tool cv-lib-add" type="button">${icon('plus', 14)}</button></div>` +
      '<div class="cv-lib-form cv-mcp-form" hidden>' +
      '<label class="cv-lib-field"><span class="cv-lib-flabel" data-l="name"></span><input class="cv-input" data-f="name" spellcheck="false" autocomplete="off"></label>' +
      '<label class="cv-lib-field"><span class="cv-lib-flabel" data-l="transport"></span><select class="cv-input" data-f="transport"><option value="http">HTTP</option><option value="stdio">stdio</option></select></label>' +
      '<label class="cv-lib-field" data-for="http"><span class="cv-lib-flabel" data-l="url"></span><input class="cv-input" data-f="url" spellcheck="false" autocomplete="off" placeholder="https://"></label>' +
      '<label class="cv-lib-field" data-for="stdio" hidden><span class="cv-lib-flabel" data-l="command"></span><input class="cv-input" data-f="command" spellcheck="false" autocomplete="off"></label>' +
      '<label class="cv-lib-field" data-for="http"><span class="cv-lib-flabel" data-l="headers"></span><textarea class="cv-input cv-lib-area" data-f="headers" spellcheck="false" rows="2" placeholder="Authorization: Bearer ..."></textarea></label>' +
      '<label class="cv-lib-check"><input type="checkbox" data-f="sessions"><span data-l="sessions"></span></label>' +
      '<div class="cv-lib-formbar"><button class="cv-lib-btn cv-mcp-submit" type="button"></button><button class="cv-lib-btn cv-lib-ghost cv-mcp-cancel" type="button"></button></div></div>' +
      '<div class="cv-lib-list" role="list"></div></div>'));
    this.count = q(host, '.cv-lib-count');
    this.list = q(host, '.cv-lib-list');
    this.addBtn = q(host, '.cv-lib-add');
    this.refreshBtn = q(host, '.cv-lib-refresh');
    this.form = q(host, '.cv-mcp-form');
    this.addBtn.addEventListener('click', () => setHidden(this.form, !this.form.hidden));
    this.refreshBtn.addEventListener('click', () => void this.refresh());
    q(host, '.cv-mcp-cancel').addEventListener('click', () => setHidden(this.form, true));
    q(host, '.cv-mcp-submit').addEventListener('click', () => void this.submit());
    this.field('transport').addEventListener('change', () => this.syncTransport());
    onLanguage(() => { this.relabel(); this.render(); });
    this.relabel();
    this.syncTransport();
  }

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return q<T>(this.form, `[data-f="${name}"]`);
  }

  private relabel(): void {
    const labels: Record<string, string> = { name: 'Name', transport: 'Transport', url: 'URL', command: 'Command', headers: 'Headers, one Name: value per line (kept in the keyring)', sessions: 'Offer to agent sessions (mcp.json)' };
    for (const node of Array.from(this.form.querySelectorAll<HTMLElement>('[data-l]'))) setText(node, t(labels[node.dataset.l ?? ''] ?? ''));
    setText(q(this.form, '.cv-mcp-submit'), t('Add and connect'));
    setText(q(this.form, '.cv-mcp-cancel'), t('Cancel'));
    for (const [btn, label] of [[this.addBtn, 'Add MCP server'], [this.refreshBtn, 'Refresh']] as const) {
      setTitle(btn, t(label));
      btn.setAttribute('aria-label', t(label));
    }
  }

  private syncTransport(): void {
    const stdio = this.field<HTMLSelectElement>('transport').value === 'stdio';
    for (const node of Array.from(this.form.querySelectorAll<HTMLElement>('[data-for]'))) setHidden(node, (node.dataset.for === 'stdio') !== stdio);
  }

  async refresh(): Promise<void> {
    try {
      const d = await library.mcp();
      this.rows = [...d.builtin, ...d.servers];
    } catch {
      this.rows = [];
    }
    this.render();
  }

  private async act(call: () => Promise<unknown>, what: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await call();
    } catch (err) {
      fail(err, what);
    } finally {
      this.busy = false;
      await this.refresh();
      toolsChanged();
    }
  }

  private parseHeaders(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of this.field<HTMLTextAreaElement>('headers').value.split('\n')) {
      const at = line.indexOf(':');
      if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return out;
  }

  private async submit(): Promise<void> {
    const transport = this.field<HTMLSelectElement>('transport').value === 'stdio' ? 'stdio' : 'http';
    const body = {
      name: this.field('name').value.trim(),
      transport,
      url: this.field('url').value.trim(),
      command: this.field('command').value.trim(),
      headers: transport === 'http' ? this.parseHeaders() : {},
      sessions: this.field('sessions').checked,
    } as const;
    await this.act(async () => {
      const out = await library.addMcp(body);
      toast(`${body.name}: ${out.status === 'connected' ? out.detail : out.detail || t('could not connect')}`, out.status === 'connected' ? 'info' : 'error');
      this.field('headers').value = '';
      setHidden(this.form, true);
    }, 'Could not add the server');
  }

  render(): void {
    patchList(this.list, this.rows, {
      key: keyOf,
      create: (r) => this.create(r),
      update: (node, r) => this.update(node, r),
    });
    setText(this.count, tn(this.rows.filter((r) => r.origin === 'user').length, '{n} server of yours', '{n} servers of yours'));
  }

  private create(row: McpRow): HTMLElement {
    const node = el(
      '<div class="cv-lib-row cv-lib-mcp" role="listitem"><span class="cv-lib-dot"></span>' +
      '<div class="cv-lib-main"><div class="cv-lib-top"><span class="cv-lib-name"></span><span class="cv-lib-chip"></span></div><div class="cv-lib-desc"></div></div>' +
      `<button class="cv-wb-tool cv-lib-rf" type="button">${icon('refresh', 14)}</button><button class="cv-wb-tool cv-lib-rm" type="button">${icon('delete', 14)}</button></div>`);
    const tg = toggle(row.name);
    node.append(tg.root);
    const refs: Refs = { dot: q(node, '.cv-lib-dot'), name: q(node, '.cv-lib-name'), kind: q(node, '.cv-lib-chip'), detail: q(node, '.cv-lib-desc'), refresh: q(node, '.cv-lib-rf'), remove: q(node, '.cv-lib-rm'), tg, row };
    this.refs.set(node, refs);
    tg.input.addEventListener('change', () => void this.act(() => library.enableMcp(refs.row.name, tg.input.checked), 'Could not change the server'));
    refs.refresh.addEventListener('click', () => void this.act(() => library.refreshMcp(refs.row.name), 'Could not reconnect'));
    refs.remove.addEventListener('click', () => {
      void confirmAction(t('Remove MCP server'), `${refs.row.name}`, t('Remove'), true).then((yes) => {
        if (yes) void this.act(() => library.removeMcp(refs.row.name), 'Could not remove the server');
      });
    });
    this.update(node, row);
    return node;
  }

  private update(node: HTMLElement, row: McpRow): void {
    const refs = this.refs.get(node);
    if (!refs) return;
    refs.row = row;
    const user = row.origin === 'user';
    setText(refs.name, row.name);
    setText(refs.kind, row.transport);
    const where = row.transport === 'stdio' ? row.command : row.url;
    setText(refs.detail, `${row.detail}${row.tools ? ` · ${tn(row.tools, '{n} tool', '{n} tools')}` : ''}`);
    setTitle(refs.detail, where);
    refs.dot.dataset.status = row.status;
    setClass(node, 'is-off', user && !row.enabled);
    setHidden(refs.tg.root, !user);
    setHidden(refs.refresh, !user);
    setHidden(refs.remove, !user);
    setToggle(refs.tg, row.enabled, false, t(row.enabled ? 'Disable' : 'Enable'));
    for (const [btn, label] of [[refs.refresh, 'Reconnect'], [refs.remove, 'Remove']] as const) {
      setTitle(btn, t(label));
      btn.setAttribute('aria-label', t(label));
    }
  }
}
