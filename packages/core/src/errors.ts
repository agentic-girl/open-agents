export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND';

  constructor(public readonly sessionId: string) {
    super(`Session "${sessionId}" was not found.`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionBusyError extends Error {
  readonly code = 'SESSION_BUSY';

  constructor(public readonly sessionId: string) {
    super(`Session "${sessionId}" already has an active turn running.`);
    this.name = 'SessionBusyError';
  }
}

export class HarnessNotFoundError extends Error {
  readonly code = 'HARNESS_NOT_FOUND';

  constructor(public readonly harnessId: string) {
    super(`Harness adapter "${harnessId}" is not registered.`);
    this.name = 'HarnessNotFoundError';
  }
}
