import { library, type CollectionHit, type CollectionRow } from '../../io/library';
import { confirmAction } from '../../ui/dialogs';
import { el, patchList, q, setHidden, setText, setTitle } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { onLanguage, t, tn } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { fail } from '../manager/parts';

const POLL_MS = 4000;

interface Refs {
  name: HTMLElement;
  docs: HTMLElement;
  input: HTMLInputElement;
  hits: HTMLElement;
  note: HTMLElement;
  remove: HTMLButtonElement;
  go: HTMLButtonElement;
  row: CollectionRow;
}

export class CollectionsPanel {
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly form: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly refs = new WeakMap<HTMLElement, Refs>();
  private rows: CollectionRow[] = [];
  private timer = 0;
  private noWorkspace = false;

  constructor(private readonly host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib cv-col">' +
      `<div class="cv-lib-bar"><span class="cv-lib-count"></span><button class="cv-wb-tool cv-lib-refresh" type="button">${icon('refresh', 14)}</button><button class="cv-wb-tool cv-lib-add" type="button">${icon('plus', 14)}</button></div>` +
      '<div class="cv-lib-form cv-col-form" hidden>' +
      '<label class="cv-lib-field"><span class="cv-lib-flabel" data-l="name"></span><input class="cv-input" data-f="name" spellcheck="false" autocomplete="off"></label>' +
      '<label class="cv-lib-field"><span class="cv-lib-flabel" data-l="text"></span><textarea class="cv-input cv-lib-area" data-f="text" rows="4" spellcheck="false"></textarea></label>' +
      '<div class="cv-lib-formbar"><button class="cv-lib-btn cv-col-submit" type="button"></button></div></div>' +
      '<p class="cv-note cv-lib-hint cv-col-note"></p>' +
      '<div class="cv-lib-list" role="list"></div></div>'));
    this.count = q(host, '.cv-lib-count');
    this.list = q(host, '.cv-lib-list');
    this.note = q(host, '.cv-col-note');
    this.form = q(host, '.cv-col-form');
    this.addBtn = q(host, '.cv-lib-add');
    this.refreshBtn = q(host, '.cv-lib-refresh');
    this.addBtn.addEventListener('click', () => setHidden(this.form, !this.form.hidden));
    this.refreshBtn.addEventListener('click', () => void this.refresh());
    q(host, '.cv-col-submit').addEventListener('click', () => void this.add());
    onLanguage(() => { this.relabel(); this.render(); });
    this.relabel();
    this.timer = window.setInterval(() => { if (this.host.offsetParent !== null && !document.hidden) void this.refresh(); }, POLL_MS);
  }

  private relabel(): void {
    for (const node of Array.from(this.form.querySelectorAll<HTMLElement>('[data-l]'))) setText(node, t(node.dataset.l === 'name' ? 'Collection' : 'Document text'));
    setText(q(this.form, '.cv-col-submit'), t('Add document'));
    for (const [btn, label] of [[this.addBtn, 'Add a document'], [this.refreshBtn, 'Refresh']] as const) {
      setTitle(btn, t(label));
      btn.setAttribute('aria-label', t(label));
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const d = await library.collections();
      this.rows = d.collections;
      this.noWorkspace = d.workspace === false;
    } catch {
      this.rows = [];
    }
    this.render();
  }

  private render(): void {
    patchList(this.list, this.rows, {
      key: (r) => r.name,
      create: (r) => this.create(r),
      update: (node, r) => this.update(node, r),
    });
    setText(this.count, tn(this.rows.length, '{n} collection', '{n} collections'));
    setText(this.note, this.noWorkspace ? t('Open a folder to use collections') : this.rows.length ? '' : t('No collections yet. Agents create them with add_knowledge, or use the plus button.'));
  }

  private create(row: CollectionRow): HTMLElement {
    const node = el(
      '<div class="cv-lib-block cv-col-item" role="listitem"><div class="cv-lib-row cv-col-head">' +
      `${icon('libStack', 14)}<div class="cv-lib-main"><div class="cv-lib-top"><span class="cv-lib-name"></span><span class="cv-lib-chip"></span></div></div>` +
      `<button class="cv-wb-tool cv-col-rm" type="button">${icon('delete', 14)}</button></div>` +
      '<form class="cv-col-search"><input class="cv-input" type="text" spellcheck="false" autocomplete="off">' +
      `<button class="cv-wb-tool cv-col-go" type="submit">${icon('search', 14)}</button></form>` +
      '<p class="cv-note cv-col-hitnote" hidden></p><div class="cv-col-hits" role="list"></div></div>');
    const refs: Refs = { name: q(node, '.cv-lib-name'), docs: q(node, '.cv-lib-chip'), input: q(node, 'form input'), hits: q(node, '.cv-col-hits'), note: q(node, '.cv-col-hitnote'), remove: q(node, '.cv-col-rm'), go: q(node, '.cv-col-go'), row };
    this.refs.set(node, refs);
    q(node, 'form').addEventListener('submit', (e) => { e.preventDefault(); void this.search(refs); });
    refs.remove.addEventListener('click', () => {
      void confirmAction(t('Delete collection'), refs.row.name, t('Delete'), true).then((yes) => {
        if (!yes) return;
        library.removeCollection(refs.row.name).then(() => this.refresh(), (err: unknown) => fail(err, 'Could not delete the collection'));
      });
    });
    this.update(node, row);
    return node;
  }

  private update(node: HTMLElement, row: CollectionRow): void {
    const refs = this.refs.get(node);
    if (!refs) return;
    refs.row = row;
    setText(refs.name, row.name);
    setText(refs.docs, tn(row.docs, '{n} doc', '{n} docs'));
    refs.input.placeholder = `${t('Search')} ${row.name}`;
    refs.input.setAttribute('aria-label', `${t('Search')} ${row.name}`);
    for (const [btn, label] of [[refs.remove, 'Delete collection'], [refs.go, 'Search']] as const) {
      setTitle(btn, t(label));
      btn.setAttribute('aria-label', t(label));
    }
  }

  private async search(refs: Refs): Promise<void> {
    const query = refs.input.value.trim();
    if (!query) return;
    try {
      const d = await library.searchCollection(refs.row.name, query);
      const items = d.hits.map((hit, i) => ({ k: String(i), hit }));
      patchList(refs.hits, items, {
        key: (x) => x.k,
        create: (x) => this.hitNode(x.hit),
        update: (node, x) => this.fillHit(node, x.hit),
      });
      setHidden(refs.note, d.hits.length > 0);
      setText(refs.note, t('No hits'));
    } catch (err) {
      fail(err, 'Search failed');
    }
  }

  private hitNode(hit: CollectionHit): HTMLElement {
    const node = el('<div class="cv-col-hit" role="listitem"><em></em><span></span></div>');
    this.fillHit(node, hit);
    return node;
  }

  private fillHit(node: HTMLElement, hit: CollectionHit): void {
    setText(q(node, 'em'), hit.score.toFixed(2));
    setText(q(node, 'span'), hit.text.slice(0, 200));
    setTitle(node, hit.text);
  }

  private async add(): Promise<void> {
    const name = q<HTMLInputElement>(this.form, '[data-f="name"]');
    const text = q<HTMLTextAreaElement>(this.form, '[data-f="text"]');
    try {
      const out = await library.addDoc(name.value.trim().toLowerCase(), text.value);
      toast(`${out.added}: ${tn(out.docs, '{n} doc', '{n} docs')}`);
      text.value = '';
      setHidden(this.form, true);
      await this.refresh();
    } catch (err) {
      fail(err, 'Could not add the document');
    }
  }
}
