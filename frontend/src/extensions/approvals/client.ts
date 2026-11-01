import { request } from '../../io/api';
import { owner } from '../../io/window-token';

export interface Approval {
  id: string;
  run_id: string;
  tool: string;
  args: Record<string, unknown> | null;
  diff: string | null;
  task: string;
}

export const APPROVALS_CHANGED = 'subform:approvals-changed';

export const approvalsApi = {
  list: (): Promise<{ approvals: Approval[] }> => request<{ approvals: Approval[] }>('/api/runs/approvals'),
  decide: (runId: string, approval: string, approved: boolean): Promise<{ approved: boolean }> =>
    owner(`/api/runs/approvals/${encodeURIComponent(runId)}`, { method: 'POST', body: JSON.stringify({ approved, approval }) }),
};

export function contextOf(a: Approval): string {
  const args = a.args ?? {};
  if (a.tool === 'run_shell') return `$ ${String(args.command ?? '')}`;
  if (a.tool === 'write_file') {
    if (a.diff) return `${String(args.path ?? '')}\n${a.diff}`;
    const content = String(args.content ?? '');
    return `${String(args.path ?? '')}\n${content.split('\n').length} lines, ${content.length} characters\n${content.slice(0, 400)}${content.length > 400 ? '\n...' : ''}`;
  }
  if (a.tool === 'http_request') return `${String(args.method ?? 'GET')} ${String(args.url ?? '')}${args.body ? `\n${String(args.body).slice(0, 300)}` : ''}`;
  return JSON.stringify(args, null, 1).slice(0, 600);
}
