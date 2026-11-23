import { syncTrust } from '../io/lsp';
import { createTaskFile, listTasks, runTask, stopTask, taskState, VSCODE_TASK_FILE, type TaskInfo, type TaskListing, type TaskState } from '../io/tasks';
import { workspaceTrusted } from '../io/trust';
import { detailOf } from '../io/workspace';
import type { Commands } from './commands';
import { Dialog } from './dialogs';
import { el, patchList, q, setClass, setHidden, setHtml, setText, setTitle } from './dom';
import { lsp, type Problem } from './editor/lsp';
import { t, tn } from './i18n';
import { icon } from './icons';
import { fuzzyScore } from './palette/fuzzy';
import { toast } from './toast';
import type { WorkspaceStore } from './workspace-store';

export interface TasksDeps {
  store: WorkspaceStore;
  commands: Commands;
  reveal: (terminalId: string) => void;
  openFile: (path: string) => void;
}

type Mode = 'all' | 'build' | 'stop';
interface Row { key: string; label: string; meta: string; icon: string; enabled: boolean; why: string; gap?: boolean }

const POLL_MS = 700;
const SLOW_MS = 250;
const SHOWN = 12;
const JOB_PREFIX = 'task:';
const PROBLEM_OWNER = 'tasks';
const TITLES: Record<Mode, string> = { all: 'Run Task', build: 'Run Build Task', stop: 'Stop Task' };
const UNTRUSTED_NOTE = 'This workspace must be trusted before its tasks can run. Use File > Trust This Workspace.';

class TaskPicker extends Dialog {
  private readonly input = el<HTMLInputElement>('<input class="cv-input" type="search" spellcheck="false" autocomplete="off">');
  private readonly list = el('<div class="cv-palette-list" role="listbox" data-no-i18n></div>');
  private readonly empty = el('<p class="cv-note cv-palette-empty" hidden></p>');
  private readonly source = el('<p class="cv-note cv-prefs-status" role="status"></p>');
  private rows: Row[] = [];
  private shown: Row[] = [];
  private selected = 0;
  private pool = 0;
  private serial = 0;
  private slow = 0;
  private note = '';
  onPick: ((label: string) => void) | null = null;
  onConfigure: (() => void) | null = null;

  constructor() {
    super('Run Task', 560);
    const box = el('<div class="cv-palette-box"></div>');
    box.append(this.list, this.empty);
    this.body.append(this.input, box, this.source);
    this.button('Configure Tasks', 'ghost', () => { this.close(); this.onConfigure?.(); });
    this.onClose = () => { this.serial++; window.clearTimeout(this.slow); };
    this.input.addEventListener('input', () => { this.selected = 0; this.paint(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.selected = Math.max(0, Math.min(this.shown.length - 1, this.selected + (e.key === 'ArrowDown' ? 1 : -1)));
        this.mark();
      } else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.selected); }
    });
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.cv-palette-row');
      if (row) this.pick(Number(row.dataset.key));
    });
  }

  ask(mode: Mode, load: () => Promise<{ rows: Row[]; note: string; source: string }>): void {
    if (this.isOpen) this.close();
    this.setTitle(TITLES[mode]);
    const hint = t(mode === 'stop' ? 'Search running tasks' : 'Search tasks');
    this.input.placeholder = hint;
    this.input.setAttribute('aria-label', hint);
    this.list.setAttribute('aria-label', t('Tasks'));
    this.input.value = '';
    this.rows = [];
    this.note = '';
    this.selected = 0;
    setText(this.source, '');
    this.paint();
    setHidden(this.empty, true);
    this.open(this.input);
    const mine = ++this.serial;
    window.clearTimeout(this.slow);
    this.slow = window.setTimeout(() => { if (mine === this.serial && !this.rows.length && !this.note) { setText(this.empty, t('Loading tasks...')); setHidden(this.empty, false); } }, SLOW_MS);
    void load().then((found) => {
      if (mine !== this.serial || !this.isOpen) return;
      window.clearTimeout(this.slow);
      this.rows = found.rows;
      this.note = found.note;
      setText(this.source, found.source);
      this.paint();
    });
  }

  private pick(i: number): void {
    const row = this.shown[i];
    if (!row?.enabled) return;
    this.close();
    this.onPick?.(row.label);
  }

  private paint(): void {
    const query = this.input.value.trim();
    const scored = this.rows.map((row) => ({ row, score: fuzzyScore(query, row.label) })).filter((x) => x.score !== null);
    if (query) scored.sort((a, b) => (b.score as number) - (a.score as number));
    this.shown = scored.map((x) => x.row).slice(0, SHOWN);
    this.selected = Math.max(0, Math.min(this.selected, this.shown.length - 1));
    this.pool = Math.max(this.pool, this.shown.length);
    const items: Row[] = Array.from({ length: this.pool }, (_, i) => this.shown[i] ?? { key: '', label: '', meta: '', icon: '', enabled: false, why: '', gap: true });
    patchList(this.list, items, {
      key: (row) => String(items.indexOf(row)),
      create: (row) => {
        const node = el<HTMLButtonElement>('<button class="cv-list-row cv-palette-row" type="button" role="option" tabindex="-1"><span class="cv-palette-icon"></span><span class="cv-list-name"></span><span class="cv-list-meta"></span></button>');
        this.fill(node, row);
        return node;
      },
      update: (node, row) => this.fill(node, row),
    });
    this.mark();
    const text = this.note || (this.rows.length && !this.shown.length ? t('No task matches.') : '');
    setText(this.empty, text);
    setHidden(this.empty, this.shown.length > 0 || !text);
  }

  private fill(node: HTMLElement, row: Row): void {
    setText(q(node, '.cv-list-name'), row.label);
    setText(q(node, '.cv-list-meta'), row.meta);
    setHidden(node, !!row.gap);
    setClass(node, 'is-off', !row.enabled);
    if (row.why || node.title) setTitle(node, row.why);
    if (node.getAttribute('aria-disabled') !== String(!row.enabled)) node.setAttribute('aria-disabled', String(!row.enabled));
    setHtml(q(node, '.cv-palette-icon'), row.icon ? icon(row.icon, 16) : '', row.icon);
  }

  private mark(): void {
    Array.from(this.list.children).forEach((node, i) => {
      setClass(node, 'is-selected', i === this.selected);
      if (node.getAttribute('aria-selected') !== String(i === this.selected)) node.setAttribute('aria-selected', String(i === this.selected));
    });
  }
}

export function installTasks(deps: TasksDeps): void {
  const { store, commands } = deps;
  let picker: TaskPicker | null = null;
  let running: string[] = [];
  let seq = -1;
  let timer = 0;
  let busy = false;
  const watched = new Set<string>();

  const apply = (state: TaskState): void => {
    const now = state.running.map((r) => r.label);
    for (const label of running) if (!now.includes(label)) store.finishJob(JOB_PREFIX + label);
    for (const label of now) if (!running.includes(label)) store.upsertJob({ id: JOB_PREFIX + label, label: `${t('Task')}: ${label}`, progress: -1, done: false, cancel: () => { void stop(label); } });
    running = now;
    for (const done of state.finished) {
      if (!watched.delete(done.label) || done.stopped) continue;
      const failed = done.exitCode !== 0;
      const words = failed ? `${t('The task failed')}${done.exitCode === null ? '' : ` (${done.exitCode})`}` : t('The task finished');
      const found = done.problems ? ` · ${tn(done.problems, '{n} problem', '{n} problems')}` : '';
      toast(`${done.label}: ${words}${found}`, failed ? 'error' : 'info', done.problems ? { actions: [{ label: t('Show Problems'), run: () => { commands.run('lsp-problems'); } }] } : {});
    }
    if (state.seq !== seq) {
      seq = state.seq;
      lsp.setExternal(PROBLEM_OWNER, state.problems.map((p): Problem => ({ path: p.path, line: p.line, col: p.col, severity: p.severity, message: p.code ? `${p.message} (${p.code})` : p.message, source: p.source })));
    }
  };

  const poll = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      apply(await taskState());
      if (!running.length && timer) { window.clearInterval(timer); timer = 0; }
    } catch {
      return;
    } finally {
      busy = false;
    }
  };

  const watch = (): void => {
    if (!timer) timer = window.setInterval(() => { void poll(); }, POLL_MS);
    void poll();
  };

  const start = async (label: string): Promise<void> => {
    try {
      await syncTrust();
      const res = await runTask(label, 100, 30);
      watched.add(label);
      deps.reveal(res.terminal.id);
      watch();
    } catch (e) {
      toast(`${label}: ${detailOf(e)}`, 'error');
    }
  };

  async function stop(label: string | null): Promise<void> {
    try { await stopTask(label); } catch (e) { toast(`${t('The task could not be stopped')}: ${detailOf(e)}`, 'error'); }
    watch();
  }

  const configure = async (): Promise<void> => {
    try {
      const file = await createTaskFile();
      deps.openFile(file.path);
    } catch (e) {
      toast(`${t('The task file could not be opened')}: ${detailOf(e)}`, 'error');
    }
  };

  const listing = async (): Promise<TaskListing | null> => {
    if (!workspaceTrusted()) return null;
    await syncTrust();
    const found = await listTasks();
    return found.trusted ? found : null;
  };

  const metaOf = (task: TaskInfo): string => {
    if (task.error) return task.error;
    const kind = task.group === 'build' ? t(task.isDefault ? 'default build task' : 'build task') : task.group === 'test' ? t('test task') : '';
    return [running.includes(task.label) ? t('running') : '', kind, task.detail].filter(Boolean).join(' · ');
  };

  const rowOf = (task: TaskInfo): Row => ({ key: task.label, label: task.label, meta: metaOf(task), icon: task.error ? 'warning' : running.includes(task.label) ? 'loading' : 'play', enabled: !task.error && !running.includes(task.label), why: task.error ?? [task.detail, ...task.notes].join('\n') });

  const ask = (mode: Mode): void => {
    picker ??= new TaskPicker();
    picker.onConfigure = () => { void configure(); };
    picker.onPick = (label) => { void (mode === 'stop' ? stop(label) : start(label)); };
    picker.ask(mode, async () => {
      try {
        if (mode === 'stop') {
          apply(await taskState());
          return { rows: running.map((label): Row => ({ key: label, label, meta: t('running'), icon: 'stop', enabled: true, why: '' })), note: running.length ? '' : t('No task is running.'), source: '' };
        }
        const found = await listing();
        if (!found) return { rows: [], note: t(UNTRUSTED_NOTE), source: '' };
        const tasks = mode === 'build' ? found.tasks.filter((x) => x.group === 'build') : found.tasks;
        const source = found.file === VSCODE_TASK_FILE ? t('Tasks are read from .vscode/tasks.json because this workspace has no .formsubstrate/tasks.json.') : '';
        const none = found.error ?? t(mode === 'build' ? 'No build task yet. Give a task the group build in the task file.' : 'No tasks yet. Configure Tasks creates .formsubstrate/tasks.json with a starter.');
        return { rows: tasks.map(rowOf), note: tasks.length ? '' : none, source: tasks.length && found.error ? found.error : source };
      } catch (e) {
        return { rows: [], note: `${t('The tasks could not be read')}: ${detailOf(e)}`, source: '' };
      }
    });
  };

  const build = async (): Promise<void> => {
    let found: TaskListing | null = null;
    try { found = await listing(); } catch { found = null; }
    const builds = (found?.tasks ?? []).filter((x) => x.group === 'build' && !x.error && !running.includes(x.label));
    const chosen = builds.filter((x) => x.isDefault);
    if (chosen.length === 1) { void start(chosen[0].label); return; }
    if (!chosen.length && builds.length === 1) { void start(builds[0].label); return; }
    ask('build');
  };

  const open = (): boolean => !!store.workspace;
  commands.add(
    { id: 'run-task', label: 'Run Task...', enabled: open, run: () => ask('all') },
    { id: 'run-build-task', label: 'Run Build Task', keys: ['Shift+Mod+B'], enabled: open, run: () => { void build(); } },
    { id: 'run-stop', label: 'Stop Task', enabled: () => running.length > 0, run: () => { if (running.length === 1) void stop(running[0]); else ask('stop'); } },
    { id: 'tasks-configure', label: 'Configure Tasks', mutates: true, enabled: open, run: () => { void configure(); } },
  );

  store.on('workspace', () => { seq = -1; void poll().then(() => { if (running.length) watch(); }); });
  void poll().then(() => { if (running.length) watch(); });
}
