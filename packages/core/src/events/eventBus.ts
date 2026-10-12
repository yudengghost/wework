export type EventMap = Record<string, unknown>;

export interface EventBusOptions {
  /** 订阅者抛错时的回调；用于记录日志，避免错误被静默吞掉。 */
  onHandlerError?: (error: unknown, event: string) => void;
}

type AnyHandler = (payload: unknown) => void;

export class EventBus<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Set<AnyHandler>>();

  constructor(private readonly options: EventBusOptions = {}) {}

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set<AnyHandler>();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => this.off(event, handler);
  }

  off<K extends keyof E>(event: K, handler: (payload: E[K]) => void): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as AnyHandler);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // 快照派发：允许订阅者在回调中退订而不影响本轮。
    for (const handler of [...set]) {
      try {
        (handler as (value: E[K]) => void)(payload);
      } catch (error) {
        this.options.onHandlerError?.(error, String(event));
      }
    }
  }

  listenerCount<K extends keyof E>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
