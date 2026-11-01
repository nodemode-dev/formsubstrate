type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriInvoke = (): Invoke | null => {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
};

const windowFocused = (): boolean => document.hasFocus() && !document.hidden;

async function viaTauri(invoke: Invoke, title: string, body: string): Promise<boolean> {
  try {
    let granted = (await invoke('plugin:notification|is_permission_granted')) === true;
    if (!granted) granted = (await invoke('plugin:notification|request_permission')) === 'granted';
    if (!granted) return true;
    await invoke('plugin:notification|notify', { options: { title, body } });
    return true;
  } catch {
    return false;
  }
}

function viaWeb(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch { return; }
}

export function primeDesktopNotifications(): void {
  if (tauriInvoke() || typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  void Notification.requestPermission().catch(() => undefined);
}

export function desktopNotify(title: string, body: string): void {
  if (windowFocused()) return;
  const invoke = tauriInvoke();
  if (invoke) {
    void viaTauri(invoke, title, body).then((ok) => { if (!ok) viaWeb(title, body); });
    return;
  }
  viaWeb(title, body);
}
