import { el, patchList, q, setText, setTitle } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { onLanguage, t, tn } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { insertAtCursor, listBlocks, onBlocks, type Block } from './registry';

export class BlocksPanel {
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly count: HTMLElement;

  constructor(host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib-pane"><div class="cv-lib-bar"><span class="cv-lib-count"></span></div>' +
      '<p class="cv-note cv-lib-hint"></p><div class="cv-lib-list" role="list"></div></div>'));
    this.list = q(host, '.cv-lib-list');
    this.note = q(host, '.cv-lib-hint');
    this.count = q(host, '.cv-lib-count');
    onBlocks(() => this.render());
    onLanguage(() => this.render());
    this.render();
  }

  private render(): void {
    const snippets = listBlocks('snippet');
    const studio = listBlocks('tool').length + listBlocks('mcp').length + listBlocks('studio').length;
    patchList(this.list, snippets, {
      key: (b) => b.id,
      create: (b) => this.create(b),
      update: (node, b) => this.update(node, b),
    });
    setText(this.count, tn(snippets.length, '{n} block', '{n} blocks'));
    setText(this.note, `${t('Insert semantic HTML at the editor cursor. The code stays the source of truth.')} ${tn(studio, '{n} block for the Studio palette.', '{n} blocks for the Studio palette.')}`);
  }

  private create(block: Block): HTMLElement {
    const node = el(`<button class="cv-lib-row cv-lib-blk" type="button" role="listitem">${icon(block.icon, 14)}<div class="cv-lib-main"><div class="cv-lib-name"></div><div class="cv-lib-desc"></div></div></button>`);
    node.addEventListener('click', () => {
      const current = listBlocks('snippet').find((b) => b.id === node.dataset.key);
      if (!current?.code) return;
      if (insertAtCursor(current.code)) toast(`${t(current.label)}: ${t('inserted at the cursor')}`);
      else toast(t('Open a file in the editor first'), 'error');
    });
    this.update(node, block);
    return node;
  }

  private update(node: HTMLElement, block: Block): void {
    setText(q(node, '.cv-lib-name'), t(block.label));
    setText(q(node, '.cv-lib-desc'), t(block.hint));
    setTitle(node, t(block.hint));
  }
}
