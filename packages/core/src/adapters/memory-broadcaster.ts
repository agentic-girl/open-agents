import type { BroadcasterAdapter, BroadcastFrame } from '../ports.js';

export class InMemoryBroadcaster implements BroadcasterAdapter {
  private readonly channels = new Map<string, Set<(frame: BroadcastFrame) => void>>();

  publish(sessionId: string, frame: BroadcastFrame): void {
    const listeners = this.channels.get(sessionId);
    if (!listeners || listeners.size === 0) return;

    for (const listener of listeners) {
      try {
        listener(frame);
      } catch {
        // Isolate individual listener errors from the broadcast bus
      }
    }
  }

  subscribe(sessionId: string, listener: (frame: BroadcastFrame) => void): () => void {
    let listeners = this.channels.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.channels.set(sessionId, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = this.channels.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.channels.delete(sessionId);
      }
    };
  }

  close(): void {
    this.channels.clear();
  }
}
