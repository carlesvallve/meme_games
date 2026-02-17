type Listener = (data?: unknown) => void;

export class EventBus {
  private listeners: Record<string, Listener[]> = {};

  on(event: string, callback: Listener): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return this;
  }

  off(event: string, callback: Listener): this {
    if (!this.listeners[event]) return this;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    return this;
  }

  emit(event: string, data?: unknown): this {
    if (!this.listeners[event]) return this;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`EventBus error in ${event}:`, err);
      }
    });
    return this;
  }

  removeAll(): this {
    this.listeners = {};
    return this;
  }
}

export const eventBus = new EventBus();
