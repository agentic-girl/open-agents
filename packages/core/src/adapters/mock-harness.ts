import { BaseAgentHarness, StepAction } from '../harness/base-harness.js';
import { HarnessConfig, HarnessUsage } from '../types/index.js';
import { EventStore } from '../store/event-store.js';

export interface MockHarnessConfig extends HarnessConfig {
  scriptedSteps?: StepAction[];
}

export class MockAgentHarness extends BaseAgentHarness {
  private script: StepAction[];
  private currentStep = 0;

  constructor(config: MockHarnessConfig, store: EventStore) {
    super(config, store);
    this.script = config.scriptedSteps || [
      { type: 'thought', content: 'Analyzing user request...' },
      { type: 'message', content: 'Task completed successfully.' },
      { type: 'complete', content: 'Done.' },
    ];
  }

  setScript(steps: StepAction[]): void {
    this.script = steps;
    this.currentStep = 0;
  }

  protected async executeStep(
    _sessionId: string,
    _history: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>,
    usage: HarnessUsage,
  ): Promise<StepAction> {
    // Simulate token usage
    usage.tokensUsed += 150;

    if (this.currentStep < this.script.length) {
      const action = this.script[this.currentStep];
      this.currentStep += 1;
      return action;
    }

    return { type: 'complete', content: 'Finished.' };
  }
}
