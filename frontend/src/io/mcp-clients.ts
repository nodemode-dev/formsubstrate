import { owner } from './window-token';

export interface McpClient {
  id: string;
  name: string;
  created: string | null;
  lastUsed: string | null;
}

export interface NewMcpClient {
  client: McpClient;
  token: string;
}

const BASE = '/api/mcp-clients';

export async function listMcpClients(): Promise<McpClient[]> {
  return (await owner<{ clients: McpClient[] }>(BASE)).clients;
}

export function addMcpClient(name: string): Promise<NewMcpClient> {
  return owner<NewMcpClient>(BASE, { method: 'POST', body: JSON.stringify({ name }) });
}

export async function removeMcpClient(id: string): Promise<void> {
  await owner<void>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
