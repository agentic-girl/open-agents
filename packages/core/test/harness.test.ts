import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MemoryEventStore } from '../src/store/memory-event-store.js';
import { MockAgentHarness } from '../src/adapters/mock-harness.js';
import { defineTool } from '../src/tools/tool-registry.js';

describe('BaseAgentHarness & Harness Guardrails', () => {
  it('executes a basic script and appends all lifecycle events', async () => {
    const store = new MemoryEventStore();
    const harness = new MockAgentHarness(
      {
        agentId: 'test-agent',
        instructions: 'Test instructions',
        scriptedSteps: [
          { type: 'thought', content: 'Step 1: Check input' },
          { type: 'message', content: 'Processing query' },
          { type: 'complete', content: 'All finished.' },
        ],
      },
      store,
    );

    const result = await harness.run({
      sessionId: 'sess-harness-1',
      prompt: 'Do something',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('All finished.');
    expect(result.usage.stepsTaken).toBe(3);

    const events = await store.getDelta('sess-harness-1', -1);
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      'agent:started',
      'agent:thought',
      'agent:message',
      'agent:completed',
    ]);
  });

  it('enforces maxSteps limit as a hard boundary', async () => {
    const store = new MemoryEventStore();
    const harness = new MockAgentHarness(
      {
        agentId: 'looping-agent',
        instructions: 'Test instructions',
        limits: { maxSteps: 2 },
        scriptedSteps: [
          { type: 'thought', content: 'Loop 1' },
          { type: 'thought', content: 'Loop 2' },
          { type: 'thought', content: 'Loop 3' },
        ],
      },
      store,
    );

    const result = await harness.run({
      sessionId: 'sess-limits',
      prompt: 'Infinite loop prompt',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('maxSteps (2) exceeded');

    const session = await store.getSession('sess-limits');
    expect(session?.status).toBe('failed');
  });

  it('triggers an approval interrupt on sensitive tools and resumes upon approval', async () => {
    const store = new MemoryEventStore();

    let toolExecuted = false;
    const dangerousTool = defineTool({
      name: 'deployProduction',
      description: 'Deploys new release to production',
      parameters: z.object({
        version: z.string(),
      }),
      execute: async ({ version }) => {
        toolExecuted = true;
        return { deployed: true, version };
      },
    });

    const harness = new MockAgentHarness(
      {
        agentId: 'deploy-agent',
        instructions: 'Deploy releases',
        tools: [dangerousTool],
        approvalRules: [
          {
            toolName: 'deployProduction',
            message: 'Production deployment requires human sign-off',
          },
        ],
        scriptedSteps: [
          {
            type: 'tool_call',
            toolName: 'deployProduction',
            toolArgs: { version: 'v2.0.0' },
          },
        ],
      },
      store,
    );

    // 1. Run initially -> Should suspend
    const result = await harness.run({
      sessionId: 'sess-approval',
      prompt: 'Please deploy v2.0.0',
    });

    expect(result.status).toBe('suspended');
    expect(toolExecuted).toBe(false);

    const session = await store.getSession('sess-approval');
    expect(session?.status).toBe('suspended');

    const events = await store.getDelta('sess-approval', -1);
    const suspendedEvent = events.find((e) => e.type === 'agent:suspended');
    expect(suspendedEvent).toBeDefined();
    const interruptId = suspendedEvent?.payload.interruptId as string;
    expect(interruptId).toBeDefined();

    // 2. Resume with approval -> Should execute tool and resume
    harness.setScript([
      { type: 'message', content: 'Deployment completed' },
      { type: 'complete', content: 'Done.' },
    ]);

    const resumeResult = await harness.resume({
      interruptId,
      approved: true,
    });

    expect(toolExecuted).toBe(true);
    expect(resumeResult.status).toBe('completed');

    const finalEvents = await store.getDelta('sess-approval', -1);
    const resumedEvent = finalEvents.find((e) => e.type === 'agent:resumed');
    expect(resumedEvent).toBeDefined();
  });
});
