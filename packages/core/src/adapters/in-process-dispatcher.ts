import type { TurnDispatcherAdapter, TurnJob, TurnJobHandler } from '../ports.js';

interface ActiveRun {
  controller: AbortController;
  promise: Promise<void>;
}

export class InProcessTurnDispatcher implements TurnDispatcherAdapter {
  private handler: TurnJobHandler | null = null;
  private readonly activeRuns = new Map<string, ActiveRun>();

  registerHandler(handler: TurnJobHandler): void {
    this.handler = handler;
  }

  async enqueue(job: TurnJob): Promise<void> {
    const handler = this.handler;
    if (!handler) {
      throw new Error('No TurnJobHandler registered on InProcessTurnDispatcher.');
    }

    const controller = new AbortController();
    const promise = (async () => {
      try {
        await handler(job, controller.signal);
      } finally {
        this.activeRuns.delete(job.sessionId);
      }
    })();

    this.activeRuns.set(job.sessionId, { controller, promise });
  }

  async abort(sessionId: string): Promise<boolean> {
    const active = this.activeRuns.get(sessionId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async close(): Promise<void> {
    for (const active of this.activeRuns.values()) {
      active.controller.abort();
    }
    await Promise.allSettled(Array.from(this.activeRuns.values(), (r) => r.promise));
    this.activeRuns.clear();
  }
}
