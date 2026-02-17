type Listener = (...args: unknown[]) => void;

/** Singleton pub-sub event bus for decoupled communication. */
class EventBusClass {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const EventBus = new EventBusClass();
