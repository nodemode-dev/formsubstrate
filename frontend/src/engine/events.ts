export type Origin = 'canvas' | 'code' | 'system';

export interface ChangeEvent {
  origin: Origin;
}

type Handler<T> = (payload: T) => void;

export class EventBus<T> {
  private readonly handlers = new Set<Handler<T>>();

  on(handler: Handler<T>): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  emit(payload: T): void {
    for (const h of Array.from(this.handlers)) h(payload);
  }
}
