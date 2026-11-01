export interface SashOptions {
  min: number;
  max: number;
  def: number;
  step?: number;
  dir?: 1 | -1;
  axis?: 'x' | 'y';
  read(): number;
  write(value: number): void;
  at(e: PointerEvent): number;
  commit(): void;
  dragging?(on: boolean): void;
  toggle?(): void;
}

export function bindSash(grip: HTMLElement, o: SashOptions): void {
  const step = o.step ?? 16;
  const dir = o.dir ?? 1;
  const axis = o.axis ?? 'x';
  const clamp = (n: number): number => Math.round(Math.min(o.max, Math.max(o.min, n)));
  let frame = 0;
  let pending = o.read();
  let moved = false;

  const flush = (): void => {
    frame = 0;
    o.write(pending);
  };

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    pending = o.read();
    moved = false;
    o.dragging?.(true);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    pending = clamp(o.at(e));
    moved = true;
    if (!frame) frame = requestAnimationFrame(flush);
  });
  const end = (e: PointerEvent): void => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    grip.releasePointerCapture(e.pointerId);
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (moved) o.write(pending);
    o.dragging?.(false);
    o.commit();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => {
    o.write(o.def);
    o.commit();
  });
  grip.addEventListener('keydown', (e) => {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const mult = e.shiftKey ? 4 : 1;
    let next: number | null = null;
    if (e.key === back) next = o.read() + dir * -1 * step * mult;
    else if (e.key === fwd) next = o.read() + dir * step * mult;
    else if (e.key === 'Home') next = o.def;
    else if (e.key === 'Enter' && o.toggle) { e.preventDefault(); o.toggle(); return; }
    if (next === null) return;
    e.preventDefault();
    o.write(clamp(next));
    o.commit();
  });
}
