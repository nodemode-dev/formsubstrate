import { request } from './api';
import type { TerminalInfo } from './terminals';
import { owner } from './window-token';

export interface TaskInfo {
  label: string;
  origin: 'file' | 'npm';
  error: string | null;
  detail: string;
  type: 'shell' | 'process' | null;
  group: 'build' | 'test' | null;
  isDefault: boolean;
  matchers: string[];
  notes: string[];
}

export interface TaskListing { root: string | null; trusted: boolean; file: string | null; error: string | null; tasks: TaskInfo[] }
export interface TaskProblem { path: string; line: number; col: number; severity: 1 | 2 | 3; message: string; code: string | null; source: string }
export interface TaskRunning { label: string; terminal: string; started: number }
export interface TaskFinished { label: string; terminal: string; exitCode: number | null; stopped: boolean; ended: number; problems: number }
export interface TaskState { root: string | null; seq: number; running: TaskRunning[]; finished: TaskFinished[]; problems: TaskProblem[] }

export const OWN_TASK_FILE = '.formsubstrate/tasks.json';
export const VSCODE_TASK_FILE = '.vscode/tasks.json';

export function listTasks(): Promise<TaskListing> {
  return request<TaskListing>('/api/tasks');
}

export function taskState(): Promise<TaskState> {
  return request<TaskState>('/api/tasks/state');
}

export function runTask(label: string, cols: number, rows: number): Promise<{ label: string; terminal: TerminalInfo }> {
  return owner('/api/tasks/run', { method: 'POST', body: JSON.stringify({ label, cols, rows }) });
}

export function stopTask(label: string | null): Promise<{ stopped: string[] }> {
  return owner('/api/tasks/stop', { method: 'POST', body: JSON.stringify({ label }) });
}

export function createTaskFile(): Promise<{ path: string; created: boolean }> {
  return owner('/api/tasks/file', { method: 'POST' });
}
