import dotenv from 'dotenv';
import path from 'node:path';
import {
  ApprovalDecision,
  BaseAgentHarness,
  ClaudeAgentHarness,
  EventStore,
  MockAgentHarness,
  SqliteEventStore,
} from '@open-agents/core';
import { queryDatabaseTool, deployServiceTool, sendNotificationTool } from './sample-tools.js';

export class AgentRuntime {
  public store: EventStore;
  private harnesses = new Map<string, BaseAgentHarness>();
  private activeJobs = new Map<string, Promise<unknown>>();

  constructor(dbPath?: string) {
    this.store = new SqliteEventStore({ dbPath: dbPath || 'open-agents.db' });
    this.initAgents();
  }

  private reloadEnv(): void {
    dotenv.config();
    dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
    dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: true });
  }

  private initAgents(): void {
    this.reloadEnv();
    const tools = [queryDatabaseTool, deployServiceTool, sendNotificationTool];
    const approvalRules = [
      {
        toolName: 'deployService',
        condition: (args: Record<string, unknown>) => args.environment === 'production',
        message: 'Production deployments require explicit human operator approval.',
      },
    ];

    const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

    if (hasAnthropic) {
      const claudeHarness = new ClaudeAgentHarness(
        {
          agentId: 'claude-ops',
          instructions:
            'You are a senior DevOps and Data Engineer. Use provided tools to query metrics, deploy services, and send notifications. Always verify details before executing.',
          tools,
          approvalRules,
        },
        this.store,
      );
      this.harnesses.set('claude-ops', claudeHarness);
    }

    // Default Demo / Mock Harness (Works 100% out of the box without API keys)
    const mockHarness = new MockAgentHarness(
      {
        agentId: 'default-ops',
        instructions: 'Autonomous DevOps agent with human-in-the-loop approval gates.',
        tools,
        approvalRules,
        scriptedSteps: [
          { type: 'thought', content: 'Received deployment request. Checking warehouse database first...' },
          {
            type: 'tool_call',
            toolName: 'queryDatabase',
            toolArgs: { query: 'SELECT * FROM users WHERE plan = "enterprise" LIMIT 3' },
          },
          { type: 'thought', content: 'Database records verified. Initiating production release...' },
          {
            type: 'tool_call',
            toolName: 'deployService',
            toolArgs: { service: 'payment-gateway', environment: 'production', tag: 'v2.4.1' },
          },
          { type: 'thought', content: 'Deployment approved and verified. Sending Slack notification.' },
          {
            type: 'tool_call',
            toolName: 'sendNotification',
            toolArgs: {
              channel: '#ops-deployments',
              message: 'payment-gateway v2.4.1 successfully deployed to production.',
              priority: 'high',
            },
          },
          {
            type: 'message',
            content:
              '✅ Production deployment of **payment-gateway (v2.4.1)** completed successfully.\n- Database verified\n- Human approval granted\n- Slack alert delivered to #ops-deployments',
          },
          { type: 'complete', content: 'Task finished successfully.' },
        ],
      },
      this.store,
    );
    this.harnesses.set('default-ops', mockHarness);
  }

  getHarness(agentId?: string): BaseAgentHarness {
    this.reloadEnv();
    if (process.env.ANTHROPIC_API_KEY && !this.harnesses.has('claude-ops')) {
      this.initAgents();
    }

    if (agentId && this.harnesses.has(agentId)) {
      return this.harnesses.get(agentId)!;
    }

    // Prefer Claude if available
    if (this.harnesses.has('claude-ops')) {
      return this.harnesses.get('claude-ops')!;
    }

    return this.harnesses.get('default-ops')!;
  }

  listAgents(): Array<{ id: string; type: string }> {
    this.reloadEnv();
    if (process.env.ANTHROPIC_API_KEY && !this.harnesses.has('claude-ops')) {
      this.initAgents();
    }

    return Array.from(this.harnesses.entries()).map(([id, harness]) => ({
      id,
      type: harness instanceof ClaudeAgentHarness ? 'Claude Agent SDK (Live Anthropic API)' : 'Mock/Test Engine',
    }));
  }

  /**
   * Enqueues an agent task in the durable background worker
   */
  dispatchPrompt(sessionId: string, prompt: string, agentId?: string): void {
    const harness = this.getHarness(agentId);

    const job = (async () => {
      try {
        await harness.run({ sessionId, prompt });
      } catch (err) {
        console.error(`[Worker] Unhandled error running session ${sessionId}:`, err);
      } finally {
        this.activeJobs.delete(sessionId);
      }
    })();

    this.activeJobs.set(sessionId, job);
  }

  /**
   * Resumes an agent after a human approval decision
   */
  dispatchResume(decision: ApprovalDecision, agentId?: string): void {
    const harness = this.getHarness(agentId);

    const job = (async () => {
      try {
        await harness.resume(decision);
      } catch (err) {
        console.error(`[Worker] Unhandled error resuming interrupt ${decision.interruptId}:`, err);
      }
    })();

    this.activeJobs.set(decision.interruptId, job);
  }
}
