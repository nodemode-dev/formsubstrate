import { Commands } from '../commands';
import { PopupMenu, type MenuItem } from '../menu';

export interface CtxEntry { label: string; run(): void; disabled?: boolean }
export type CtxItem = CtxEntry | '-' | { label: string; items: CtxEntry[] };

const SLOTS = 32;

export class CtxMenu {
  private readonly commands = new Commands();
  private readonly menu: PopupMenu;
  private readonly slots: Array<CtxEntry | null> = Array.from({ length: SLOTS }, () => null);

  constructor() {
    this.menu = new PopupMenu(this.commands, null, true);
    this.menu.panel.classList.add('cv-wb-context');
    for (let i = 0; i < SLOTS; i += 1) {
      this.commands.add({
        id: `st-ctx-${i}`,
        label: () => this.slots[i]?.label ?? '',
        enabled: () => !!this.slots[i] && !this.slots[i]?.disabled,
        run: () => { this.slots[i]?.run(); },
      });
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.menu.isOpen) this.menu.close(); });
  }

  get isOpen(): boolean { return this.menu.isOpen; }

  close(): void { this.menu.close(); }

  show(x: number, y: number, items: CtxItem[]): void {
    let next = 0;
    const take = (entry: CtxEntry): string => {
      const at = next;
      next += 1;
      this.slots[at] = entry;
      return `st-ctx-${at}`;
    };
    const built: MenuItem[] = [];
    for (const item of items) {
      if (item === '-') built.push('-');
      else if ('items' in item) built.push({ label: item.label, items: item.items.map(take) });
      else built.push(take(item));
    }
    for (let i = next; i < SLOTS; i += 1) this.slots[i] = null;
    this.menu.setItems(built);
    this.menu.openAt(x, y);
  }
}
