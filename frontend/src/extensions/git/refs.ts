import { git, GitError, type Branches, type GitStatus, type Stash, type Tag } from '../../io/git';
import { Commands } from '../../ui/commands';
import { confirmAction, Dialog } from '../../ui/dialogs';
import { el, patchList, q, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { enhanceSelect } from '../../ui/dropdown';
import { t } from '../../ui/i18n';
import { icon } from '../../ui/icons';
import { PopupMenu, type MenuItem } from '../../ui/menu';

export interface RefsHost {
  session(): string | null;
  status(): GitStatus | null;
  busy(): boolean;
  run(job: () => Promise<void>): Promise<void>;
  say(text: string, bad: boolean): void;
  applied(s: GitStatus): void;
  changed(): void;
  schedule(): void;
}

export interface RefsData { branches: Branches | null; stashes: Stash[] | null; tags: Tag[] | null }

export const REFS_HTML = `<div class="cv-sc-refs cv-sc-stashes"><div class="cv-sc-refs-bar"><span class="cv-sc-refs-t"></span><span class="cv-sc-refs-n"></span><button class="cv-wb-tool cv-sc-refs-add" type="button" data-act="stash">${icon('add', 14)}</button></div><div class="cv-sc-refs-list" role="list"></div><p class="cv-sc-refs-empty cv-note"></p></div>
<div class="cv-sc-refs cv-sc-tags"><div class="cv-sc-refs-bar"><span class="cv-sc-refs-t"></span><span class="cv-sc-refs-n"></span><button class="cv-wb-tool cv-sc-refs-add" type="button" data-act="tag">${icon('add', 14)}</button></div><div class="cv-sc-refs-list" role="list"></div><p class="cv-sc-refs-empty cv-note"></p></div>`;

const SESSION_WHY = 'A session keeps its own branch; choose Workspace in the target list to switch or pull';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const clock = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const lastLine = (text: string): string => text.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

class BranchDialog extends Dialog {
  private readonly name = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off">');
  private readonly from = el<HTMLSelectElement>('<select class="cv-input"></select>');
  private readonly move = el<HTMLInputElement>('<input type="checkbox">');
  private readonly moveRow: HTMLElement;
  private readonly problem = el('<p class="cv-note cv-sc-dlg-problem"></p>');
  private readonly ok: HTMLButtonElement;
  private resolve: ((v: { name: string; start: string; switch: boolean } | null) => void) | null = null;

  constructor() {
    super('Create Branch', 420);
    this.field('Branch name', this.name);
    this.field('From', this.from);
    enhanceSelect(this.from, { search: t('Filter branches') });
    this.moveRow = el('<label class="cv-field cv-check"><span></span></label>');
    setText(q(this.moveRow, 'span'), 'Switch to the new branch');
    this.moveRow.append(this.move);
    this.body.append(this.moveRow, this.problem);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.ok = this.button('Create', 'primary', () => this.submit());
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); } });
    this.name.addEventListener('input', () => { setText(this.problem, ''); setDisabled(this.ok, !this.name.value.trim()); });
    this.onClose = () => this.finish(null);
  }

  ask(b: Branches | null, mayMove: boolean): Promise<{ name: string; start: string; switch: boolean } | null> {
    const previous = this.resolve;
    this.resolve = null;
    previous?.(null);
    const items: Array<{ value: string; label: string }> = [{ value: '', label: b?.current ? `${t('Current branch')} (${b.current})` : 'HEAD' }];
    for (const l of b?.local ?? []) if (!l.current) items.push({ value: l.name, label: l.name });
    for (const r of b?.remote ?? []) items.push({ value: r.name, label: r.name });
    patchList(this.from, items, {
      key: (i) => `o:${i.value}`,
      create: (i) => { const o = document.createElement('option'); o.value = i.value; o.textContent = i.label; return o; },
      update: (n, i) => setText(n, i.label),
    });
    this.from.value = '';
    this.name.value = '';
    this.move.checked = mayMove;
    this.move.disabled = !mayMove;
    setTitle(this.moveRow, mayMove ? '' : t(SESSION_WHY));
    setText(this.problem, '');
    setDisabled(this.ok, true);
    this.open(this.name);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  private submit(): void {
    const name = this.name.value.trim();
    if (!name) return;
    if (/\s/.test(name)) { setText(this.problem, t('A branch name cannot contain spaces.')); return; }
    this.finish({ name, start: this.from.value, switch: this.move.checked && !this.move.disabled });
  }

  private finish(v: { name: string; start: string; switch: boolean } | null): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

class StashDialog extends Dialog {
  private readonly text = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="true" autocomplete="off">');
  private readonly loose = el<HTMLInputElement>('<input type="checkbox">');
  private resolve: ((v: { message: string; untracked: boolean } | null) => void) | null = null;

  constructor() {
    super('Stash Changes', 420);
    this.field('Message (optional)', this.text);
    const row = el('<label class="cv-field cv-check"><span></span></label>');
    setText(q(row, 'span'), 'Include untracked files');
    row.append(this.loose);
    this.body.append(row);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.button('Stash', 'primary', () => this.finish({ message: this.text.value.trim(), untracked: this.loose.checked }));
    this.text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.finish({ message: this.text.value.trim(), untracked: this.loose.checked }); } });
    this.onClose = () => this.finish(null);
  }

  ask(untracked: boolean): Promise<{ message: string; untracked: boolean } | null> {
    const previous = this.resolve;
    this.resolve = null;
    previous?.(null);
    this.text.value = '';
    this.loose.checked = untracked;
    this.open(this.text);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  private finish(v: { message: string; untracked: boolean } | null): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

class TagDialog extends Dialog {
  private readonly name = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off">');
  private readonly text = el<HTMLTextAreaElement>('<textarea class="cv-input cv-sc-dlg-text" rows="3" spellcheck="true"></textarea>');
  private readonly note = el('<p class="cv-note"></p>');
  private readonly ok: HTMLButtonElement;
  private resolve: ((v: { name: string; message: string } | null) => void) | null = null;

  constructor() {
    super('Create Tag', 420);
    this.field('Tag name', this.name);
    this.field('Message (optional)', this.text);
    this.body.append(this.note);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.ok = this.button('Create', 'primary', () => this.submit());
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); } });
    this.name.addEventListener('input', () => setDisabled(this.ok, !this.name.value.trim()));
    this.onClose = () => this.finish(null);
  }

  ask(head: string): Promise<{ name: string; message: string } | null> {
    const previous = this.resolve;
    this.resolve = null;
    previous?.(null);
    this.name.value = '';
    this.text.value = '';
    setText(this.note, `${t('Tags the current commit')} ${head.slice(0, 7)}. ${t('With a message the tag is annotated; without one it is lightweight.')}`);
    setDisabled(this.ok, true);
    this.open(this.name);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  private submit(): void {
    const name = this.name.value.trim();
    if (name) this.finish({ name, message: this.text.value });
  }

  private finish(v: { name: string; message: string } | null): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

export class GitRefs {
  branches: Branches | null = null;
  stashes: Stash[] = [];
  tags: Tag[] = [];
  private readonly cmds = new Commands();
  private readonly menu: PopupMenu;
  private readonly dynamic = new Set<string>();
  private readonly stashBox: HTMLElement;
  private readonly tagBox: HTMLElement;
  private branchDlg: BranchDialog | null = null;
  private stashDlg: StashDialog | null = null;
  private tagDlg: TagDialog | null = null;
  private pushTagName = '';

  constructor(host: HTMLElement, private readonly h: RefsHost) {
    this.stashBox = q(host, '.cv-sc-stashes');
    this.tagBox = q(host, '.cv-sc-tags');
    this.menu = new PopupMenu(this.cmds, null, true);
    this.menu.panel.classList.add('cv-wb-context', 'cv-sc-branchmenu');
    this.cmds.blocked = (cmd) => (this.h.session() && (cmd.id === 'gb-pull' || cmd.id === 'gb-pull-merge' || cmd.id.startsWith('sw:')) ? SESSION_WHY : '');
    this.cmds.add(
      { id: 'gb-create', label: 'Create Branch...', enabled: () => !this.h.busy() && !!this.h.status(), run: () => { void this.create(); } },
      { id: 'gb-fetch', label: 'Fetch', enabled: () => !this.h.busy() && (this.branches?.remotes.length ?? 0) > 0, run: () => { void this.fetch(); } },
      { id: 'gb-pull', label: 'Pull', enabled: () => !this.h.busy() && !!this.h.status()?.upstream, run: () => { void this.pull('ff-only'); } },
      { id: 'gb-pull-merge', label: 'Pull with a Merge Commit', enabled: () => !this.h.busy() && !!this.h.status()?.upstream, run: () => { void this.pull('merge'); } },
      { id: 'gb-stash', label: 'Stash Changes...', enabled: () => !this.h.busy() && (this.h.status()?.files.length ?? 0) > 0, run: () => { void this.stash(); } },
      { id: 'gb-tag', label: 'Create Tag...', enabled: () => !this.h.busy() && !!this.h.status()?.head, run: () => { void this.createTag(); } },
      { id: 'gb-none', label: 'No other branches', enabled: () => false, run: () => undefined },
    );
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.menu.isOpen) this.menu.close(); });
    this.stashBox.addEventListener('click', (e) => this.onStash(e));
    this.tagBox.addEventListener('click', (e) => this.onTag(e));
  }

  async read(target: string | null): Promise<RefsData> {
    const [branches, stashes, tags] = await Promise.all([git.branches(target).catch(() => null), git.stashes(target).catch(() => null), git.tags(target).catch(() => null)]);
    return { branches, stashes, tags };
  }

  take(d: RefsData): void {
    if (d.branches) this.branches = d.branches;
    if (d.stashes) this.stashes = d.stashes;
    if (d.tags) this.tags = d.tags;
    if (this.menu.isOpen && !this.pushTagName) this.menu.setItems(this.items());
  }

  reset(): void {
    this.branches = null;
    this.stashes = [];
    this.tags = [];
    this.menu.close();
  }

  private dyn(id: string, label: string, run: () => void, enabled: () => boolean = () => !this.h.busy()): string {
    if (!this.cmds.get(id)) this.cmds.add({ id, label, run, enabled, verbatim: true });
    this.dynamic.add(id);
    return id;
  }

  private prune(keep: Set<string>): void {
    for (const id of Array.from(this.dynamic)) if (!keep.has(id)) { this.cmds.remove(id); this.dynamic.delete(id); }
  }

  private items(): MenuItem[] {
    const b = this.branches;
    const keep = new Set<string>();
    const mark = (id: string): string => { keep.add(id); return id; };
    const local = (b?.local ?? []).filter((l) => !l.current);
    const names = new Set((b?.local ?? []).map((l) => l.name));
    const uplinks = new Set((b?.local ?? []).map((l) => l.upstream).filter((u): u is string => !!u));
    const remote = (b?.remote ?? []).filter((r) => !uplinks.has(r.name) && !names.has(r.name.slice(r.remote.length + 1)));
    const switchTo: MenuItem[] = local.map((l) => mark(this.dyn(`sw:${l.name}`, l.name, () => { void this.switchTo(l.name); }, () => !this.h.busy() && !l.worktree)));
    if (switchTo.length && remote.length) switchTo.push('-');
    for (const r of remote) switchTo.push(mark(this.dyn(`sw:${r.name}`, r.name, () => { void this.switchTo(r.name); })));
    const removable = local.filter((l) => !l.session && !l.worktree);
    const del: MenuItem[] = removable.map((l) => mark(this.dyn(`del:${l.name}`, l.name, () => { void this.remove(l.name); })));
    this.prune(keep);
    return [
      'gb-create',
      { label: 'Switch to Branch', items: switchTo.length ? switchTo : ['gb-none'] },
      { label: 'Delete Branch', items: del.length ? del : ['gb-none'] },
      '-',
      'gb-fetch',
      'gb-pull',
      'gb-pull-merge',
      '-',
      'gb-stash',
      'gb-tag',
    ];
  }

  openMenu(x: number, y: number): void {
    if (this.menu.isOpen) { this.menu.close(); return; }
    this.pushTagName = '';
    this.menu.setItems(this.items());
    this.menu.openAt(x, y);
    void this.read(this.h.session()).then((d) => this.take(d));
  }

  paint(): void {
    this.paintBox(this.stashBox, 'Stashes', 'Stash Changes', this.stashes.length, this.stashes.length ? '' : t('No stashes. Stash changes to set them aside without a commit.'), this.h.busy() || (this.h.status()?.files.length ?? 0) === 0);
    patchList(q(this.stashBox, '.cv-sc-refs-list'), this.stashes, {
      key: (s) => `s:${s.sha}`,
      create: (s) => {
        const n = el(`<div class="cv-sc-ref" role="listitem"><div class="cv-sc-ref-main"><span class="cv-sc-ref-t"></span><span class="cv-sc-ref-m"></span></div><span class="cv-sc-ref-acts"><button class="cv-wb-tool" type="button" data-act="apply">${icon('duplicate', 14)}</button><button class="cv-wb-tool" type="button" data-act="pop">${icon('download', 14)}</button><button class="cv-wb-tool cv-sc-ref-drop" type="button" data-act="drop">${icon('delete', 14)}</button></span></div>`);
        this.fillStash(n, s);
        return n;
      },
      update: (n, s) => this.fillStash(n, s),
    });
    this.paintBox(this.tagBox, 'Tags', 'Create Tag', this.tags.length, this.tags.length ? '' : t('No tags yet.'), this.h.busy() || !this.h.status()?.head);
    patchList(q(this.tagBox, '.cv-sc-refs-list'), this.tags, {
      key: (g) => `t:${g.name}`,
      create: (g) => {
        const n = el(`<div class="cv-sc-ref" role="listitem"><div class="cv-sc-ref-main"><span class="cv-sc-ref-t"></span><span class="cv-sc-ref-m"></span></div><span class="cv-sc-ref-acts"><button class="cv-wb-tool" type="button" data-act="push">${icon('upload', 14)}</button></span></div>`);
        this.fillTag(n, g);
        return n;
      },
      update: (n, g) => this.fillTag(n, g),
    });
  }

  private paintBox(box: HTMLElement, title: string, add: string, count: number, empty: string, addOff: boolean): void {
    setText(q(box, '.cv-sc-refs-t'), t(title));
    setText(q(box, '.cv-sc-refs-n'), count ? String(count) : '');
    const b = q<HTMLButtonElement>(box, '.cv-sc-refs-add');
    setTitle(b, t(add));
    if (b.getAttribute('aria-label') !== t(add)) b.setAttribute('aria-label', t(add));
    setDisabled(b, addOff);
    const e = q(box, '.cv-sc-refs-empty');
    setText(e, empty);
    setHidden(e, !empty);
  }

  private tool(n: HTMLElement, act: string, label: string): void {
    const b = q<HTMLButtonElement>(n, `[data-act="${act}"]`);
    setTitle(b, t(label));
    if (b.getAttribute('aria-label') !== t(label)) b.setAttribute('aria-label', t(label));
    setDisabled(b, this.h.busy());
  }

  private fillStash(n: HTMLElement, s: Stash): void {
    if (n.dataset.sha !== s.sha) n.dataset.sha = s.sha;
    if (n.dataset.index !== String(s.index)) n.dataset.index = String(s.index);
    setText(q(n, '.cv-sc-ref-t'), s.message || t('Work in progress'));
    setTitle(q(n, '.cv-sc-ref-t'), s.message);
    setText(q(n, '.cv-sc-ref-m'), [`#${s.index}`, s.branch ?? '', clock(s.created)].filter(Boolean).join(' · '));
    this.tool(n, 'apply', 'Apply (keep the stash)');
    this.tool(n, 'pop', 'Pop (apply and remove)');
    this.tool(n, 'drop', 'Drop');
  }

  private fillTag(n: HTMLElement, g: Tag): void {
    if (n.dataset.name !== g.name) n.dataset.name = g.name;
    setText(q(n, '.cv-sc-ref-t'), g.name);
    setTitle(q(n, '.cv-sc-ref-t'), g.name);
    setText(q(n, '.cv-sc-ref-m'), [g.target.slice(0, 7), g.annotated ? g.message || t('annotated') : t('lightweight')].filter(Boolean).join(' · '));
    this.tool(n, 'push', 'Push Tag');
    setDisabled(q<HTMLButtonElement>(n, '[data-act="push"]'), this.h.busy() || (this.branches?.remotes.length ?? 0) === 0);
  }

  private onStash(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const act = target?.closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
    if (act === 'stash') { void this.stash(); return; }
    const row = target?.closest<HTMLElement>('.cv-sc-ref');
    const s = this.stashes.find((x) => x.sha === row?.dataset.sha);
    if (!s || !act) return;
    if (act === 'apply') void this.apply(s, false);
    else if (act === 'pop') void this.apply(s, true);
    else if (act === 'drop') void this.drop(s);
  }

  private onTag(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest<HTMLButtonElement>('button[data-act]');
    const act = btn?.dataset.act;
    if (act === 'tag') { void this.createTag(); return; }
    const name = target?.closest<HTMLElement>('.cv-sc-ref')?.dataset.name;
    if (act === 'push' && name && btn) this.pushTag(name, btn.getBoundingClientRect());
  }

  async create(): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    this.branchDlg ??= new BranchDialog();
    const got = await this.branchDlg.ask(this.branches, !session);
    if (!got || session !== this.h.session()) return;
    await this.h.run(async () => {
      const r = await git.createBranch(got.name, { start: got.start || null, switch: got.switch, session });
      this.h.applied(r.status);
      this.h.say(r.switched ? `${t('Created and switched to')} ${r.created}` : `${t('Created branch')} ${r.created}`, false);
      this.h.changed();
    });
  }

  async switchTo(name: string): Promise<void> {
    if (this.h.busy() || this.h.session()) return;
    const hit: { err: GitError | null } = { err: null };
    await this.h.run(async () => {
      try {
        const r = await git.switchBranch(name);
        this.h.applied(r.status);
        this.h.say(`${t('Switched to')} ${r.switched}`, false);
        this.h.changed();
      } catch (err) {
        if (err instanceof GitError && err.extra.overwrite) hit.err = err;
        else throw err;
      }
    });
    if (!hit.err) return;
    const ok = await confirmAction('Switch Branch', `${hit.err.message}. ${t('Stash the changes, including untracked files, and then switch? The stash stays in the Stashes list until you apply or pop it.')}`, t('Stash and Switch'));
    if (!ok || this.h.session()) return;
    await this.h.run(async () => {
      const s = await git.stash(`${t('Before switching to')} ${name}`, true, null);
      this.stashes = s.stashes;
      this.h.applied(s.status);
      const r = await git.switchBranch(name);
      this.h.applied(r.status);
      this.h.say(`${t('Stashed the changes and switched to')} ${r.switched}`, false);
      this.h.changed();
    });
  }

  async remove(name: string): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    if (!(await confirmAction('Delete Branch', `${name}: ${t('the local branch is deleted. Its remote branch, if any, is kept.')}`, t('Delete'), true))) return;
    if (session !== this.h.session()) return;
    const hit: { unmerged: boolean } = { unmerged: false };
    await this.h.run(async () => {
      try {
        const r = await git.deleteBranch(name, false, session);
        this.h.say(`${t('Deleted branch')} ${r.deleted} (${r.sha.slice(0, 7)})`, false);
        this.h.changed();
      } catch (err) {
        if (err instanceof GitError && err.extra.unmerged) hit.unmerged = true;
        else throw err;
      }
    });
    if (!hit.unmerged) return;
    if (!(await confirmAction('Delete Unmerged Branch', `${name} ${t('has commits that are on no other branch. Deleting it drops them from the branch list; they can only be found again by their commit id.')}`, t('Delete Anyway'), true))) return;
    if (session !== this.h.session()) return;
    await this.h.run(async () => {
      const r = await git.deleteBranch(name, true, session);
      this.h.say(`${t('Deleted branch')} ${r.deleted} (${r.sha.slice(0, 7)})`, false);
      this.h.changed();
    });
  }

  async fetch(): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    await this.h.run(async () => {
      this.h.say(t('Fetching...'), false);
      const r = await git.fetch({ prune: true, session });
      if (session === this.h.session()) this.h.applied(r.status);
      this.h.say(lastLine(r.output) || t('Fetched; nothing new'), false);
      this.h.changed();
    });
  }

  async pull(mode: 'ff-only' | 'merge'): Promise<void> {
    if (this.h.busy() || this.h.session()) return;
    if (mode === 'merge' && !(await confirmAction('Pull with a Merge Commit', t('Fetch, then merge the upstream branch into the current branch with a merge commit made with your identity. A merge that stops on a conflict is aborted and nothing changes.'), t('Pull')))) return;
    const hit: { err: GitError | null } = { err: null };
    await this.h.run(async () => {
      this.h.say(t('Pulling...'), false);
      try {
        const r = await git.pull(mode);
        this.h.applied(r.status);
        const what = r.result === 'up-to-date' ? t('Already up to date') : r.result === 'merged' ? t('Pulled with a merge commit') : `${t('Pulled')} ${r.behind} ${t(r.behind === 1 ? 'commit' : 'commits')}`;
        this.h.say(what, false);
        this.h.changed();
      } catch (err) {
        if (mode === 'ff-only' && err instanceof GitError && err.extra.diverged) hit.err = err;
        else throw err;
      }
    });
    if (!hit.err) return;
    this.h.say(hit.err.message, true);
    if (await confirmAction('Branches Diverged', `${hit.err.message}. ${t('Pull with a merge commit instead?')}`, t('Pull with a Merge Commit'))) await this.pull('merge');
  }

  async stash(): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    const loose = (this.h.status()?.files ?? []).some((f) => f.kind === 'untracked');
    this.stashDlg ??= new StashDialog();
    const got = await this.stashDlg.ask(loose);
    if (!got || session !== this.h.session()) return;
    await this.h.run(async () => {
      const r = await git.stash(got.message, got.untracked, session);
      this.stashes = r.stashes;
      this.h.applied(r.status);
      this.h.say(`${t('Stashed')}: ${r.stash?.message || t('Work in progress')}`, false);
      this.h.changed();
    });
  }

  private async apply(s: Stash, pop: boolean): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    await this.h.run(async () => {
      const r = await git.applyStash(s, pop, session);
      this.stashes = r.stashes;
      this.h.applied(r.status);
      if (r.conflicted) this.h.say(t('Applied with conflicts; the stash was kept. Resolve the conflicted files.'), true);
      else this.h.say(r.dropped ? `${t('Popped')}: ${s.message || t('Work in progress')}` : `${t('Applied')}: ${s.message || t('Work in progress')}`, false);
      this.h.changed();
    });
  }

  private async drop(s: Stash): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    if (!(await confirmAction('Drop Stash', `#${s.index} ${s.message || t('Work in progress')}: ${t('the stashed changes are deleted.')}`, t('Drop'), true))) return;
    if (session !== this.h.session()) return;
    await this.h.run(async () => {
      const r = await git.dropStash(s, session);
      this.stashes = r.stashes;
      this.h.say(`${t('Dropped stash')} ${r.dropped.slice(0, 7)}`, false);
      this.h.changed();
    });
  }

  async createTag(): Promise<void> {
    if (this.h.busy()) return;
    const session = this.h.session();
    const head = this.h.status()?.head;
    if (!head) return;
    this.tagDlg ??= new TagDialog();
    const got = await this.tagDlg.ask(head);
    if (!got || session !== this.h.session()) return;
    await this.h.run(async () => {
      const r = await git.createTag(got.name, got.message, { ref: head, session });
      this.tags = r.tags;
      this.h.say(`${t('Created tag')} ${got.name}`, false);
      this.h.changed();
    });
  }

  private pushTag(name: string, at: DOMRect): void {
    const remotes = this.branches?.remotes ?? [];
    if (remotes.length === 1) { void this.pushTagTo(name, remotes[0]); return; }
    if (!remotes.length) return;
    this.pushTagName = name;
    const keep = new Set<string>(Array.from(this.dynamic).filter((id) => !id.startsWith('tp:')));
    const items = remotes.map((r) => { const id = this.dyn(`tp:${r}`, `${t('Push to')} ${r}`, () => { void this.pushTagTo(this.pushTagName, r); }); keep.add(id); return id; });
    this.prune(keep);
    this.menu.setItems(items);
    this.menu.openAt(at.left, at.bottom);
  }

  private async pushTagTo(name: string, remote: string): Promise<void> {
    this.pushTagName = '';
    if (this.h.busy()) return;
    const session = this.h.session();
    if (!(await confirmAction('Push Tag', `${name} ${t('is sent to')} ${remote}. ${t('An existing tag of that name on the remote is never overwritten.')}`, t('Push')))) return;
    await this.h.run(async () => {
      this.h.say(t('Pushing...'), false);
      try {
        const r = await git.pushTag(name, remote, session);
        this.h.say(lastLine(r.output) || t('Pushed'), false);
      } catch (err) {
        this.h.say(message(err), true);
      }
    });
  }
}
