import {
  ApprovalDecision,
  ApprovalRule,
  HarnessConfig,
  HarnessLimits,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessUsage,
  Interrupt,
  NewAgentEvent,
} from '../types/index.js';
import { EventStore } from '../store/event-store.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export interface StepAction {
  type: 'message' | 'tool_call' | 'complete' | 'thought';
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export abstract class BaseAgentHarness {
  protected config: HarnessConfig;
  protected store: EventStore;
  protected toolRegistry: ToolRegistry;
  protected limits: HarnessLimits;

  constructor(config: HarnessConfig, store: EventStore) {
    this.config = config;
    this.store = store;
    this.toolRegistry = new ToolRegistry();

    if (config.tools) {
      for (const tool of config.tools) {
        this.toolRegistry.register(tool);
      }
    }

    this.limits = {
      maxSteps: config.limits?.maxSteps ?? 10,
      maxTokens: config.limits?.maxTokens ?? 50_000,
      timeoutMs: config.limits?.timeoutMs ?? 60_000,
    };
  }

  getAgentId(): string {
    return this.config.agentId;
  }

  /**
   * Abstract method implemented by concrete adapters (Claude, Mock, Copilot, etc.)
   */
  protected abstract executeStep(
    sessionId: string,
    history: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>,
    usage: HarnessUsage,
  ): Promise<StepAction>;

  async run(options: HarnessRunOptions): Promise<HarnessRunResult> {
    const { sessionId, prompt } = options;
    const startTime = Date.now();

    const usage: HarnessUsage = {
      stepsTaken: 0,
      tokensUsed: 0,
      elapsedMs: 0,
    };

    // Ensure session exists
    let session = await this.store.getSession(sessionId);
    if (!session) {
      session = await this.store.createSession({
        id: sessionId,
        agentId: this.config.agentId,
      });
    }

    await this.store.updateSessionStatus(sessionId, 'running');

    // Emit agent:started
    await this.emit(sessionId, 'agent:started', {
      agentId: this.config.agentId,
      prompt,
      limits: this.limits,
    });

    const history: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }> = [
      { role: 'user', content: prompt },
    ];

    while (true) {
      usage.elapsedMs = Date.now() - startTime;

      // Check limits (Harness boundary guardrails)
      if (usage.stepsTaken >= this.limits.maxSteps) {
        const errorMsg = `Harness limit reached: maxSteps (${this.limits.maxSteps}) exceeded`;
        await this.emit(sessionId, 'agent:failed', { error: errorMsg, usage });
        await this.store.updateSessionStatus(sessionId, 'failed');
        return { sessionId, status: 'failed', error: errorMsg, usage };
      }

      if (usage.elapsedMs >= this.limits.timeoutMs) {
        const errorMsg = `Harness limit reached: timeoutMs (${this.limits.timeoutMs}ms) exceeded`;
        await this.emit(sessionId, 'agent:failed', { error: errorMsg, usage });
        await this.store.updateSessionStatus(sessionId, 'failed');
        return { sessionId, status: 'failed', error: errorMsg, usage };
      }

      if (usage.tokensUsed >= this.limits.maxTokens) {
        const errorMsg = `Harness limit reached: maxTokens (${this.limits.maxTokens}) exceeded`;
        await this.emit(sessionId, 'agent:failed', { error: errorMsg, usage });
        await this.store.updateSessionStatus(sessionId, 'failed');
        return { sessionId, status: 'failed', error: errorMsg, usage };
      }

      usage.stepsTaken += 1;

      // Execute next step via the adapter
      const action = await this.executeStep(sessionId, history, usage);

      if (action.type === 'thought' && action.content) {
        await this.emit(sessionId, 'agent:thought', { thought: action.content });
        history.push({ role: 'assistant', content: action.content });
        continue;
      }

      if (action.type === 'message' && action.content) {
        await this.emit(sessionId, 'agent:message', { text: action.content });
        history.push({ role: 'assistant', content: action.content });
      }

      if (action.type === 'complete') {
        await this.emit(sessionId, 'agent:completed', {
          output: action.content,
          usage,
        });
        await this.store.updateSessionStatus(sessionId, 'completed');
        return {
          sessionId,
          status: 'completed',
          output: action.content,
          usage,
        };
      }

      if (action.type === 'tool_call') {
        const toolName = action.toolName!;
        let toolArgs = action.toolArgs || {};

        // Check human-in-the-loop approval rules
        const triggerRule = this.checkApprovalRule(toolName, toolArgs);

        if (triggerRule) {
          const interruptId = `int_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const interrupt = await this.store.createInterrupt({
            id: interruptId,
            sessionId,
            type: 'tool_approval',
            toolName,
            toolArgs,
            reason: triggerRule.message || `Approval required before executing tool "${toolName}"`,
          });

          await this.emit(sessionId, 'agent:suspended', {
            interruptId: interrupt.id,
            toolName,
            toolArgs,
            reason: interrupt.reason,
          });

          await this.store.updateSessionStatus(sessionId, 'suspended');

          return {
            sessionId,
            status: 'suspended',
            usage,
          };
        }

        // Execute tool safely
        await this.emit(sessionId, 'tool:called', {
          toolName,
          toolArgs,
        });

        try {
          const result = await this.toolRegistry.execute(toolName, toolArgs, {
            sessionId,
            toolName,
          });

          await this.emit(sessionId, 'tool:result', {
            toolName,
            result,
          });

          history.push({
            role: 'tool',
            content: { toolName, result },
          });
        } catch (err: any) {
          const errorMsg = err.message || 'Tool execution failed';
          await this.emit(sessionId, 'tool:result', {
            toolName,
            error: errorMsg,
          });

          history.push({
            role: 'tool',
            content: { toolName, error: errorMsg },
          });
        }
      }
    }
  }

  async resume(decision: ApprovalDecision): Promise<HarnessRunResult> {
    const interrupt = await this.store.getInterrupt(decision.interruptId);
    if (!interrupt) {
      throw new Error(`Interrupt ${decision.interruptId} not found`);
    }

    const resolved = await this.store.resolveInterrupt(decision);

    await this.emit(interrupt.sessionId, 'agent:resumed', {
      interruptId: decision.interruptId,
      approved: decision.approved,
      modifiedArgs: decision.modifiedArgs,
      feedback: decision.feedback,
    });

    if (!decision.approved) {
      const errorMsg = decision.feedback || `Tool execution rejected by operator`;
      await this.emit(interrupt.sessionId, 'agent:failed', { error: errorMsg });
      await this.store.updateSessionStatus(interrupt.sessionId, 'failed');
      return {
        sessionId: interrupt.sessionId,
        status: 'failed',
        error: errorMsg,
        usage: { stepsTaken: 0, tokensUsed: 0, elapsedMs: 0 },
      };
    }

    // Execute the approved tool
    const toolName = interrupt.toolName!;
    const toolArgs = decision.modifiedArgs || interrupt.toolArgs || {};

    await this.emit(interrupt.sessionId, 'tool:called', {
      toolName,
      toolArgs,
      approved: true,
    });

    try {
      const result = await this.toolRegistry.execute(toolName, toolArgs, {
        sessionId: interrupt.sessionId,
        toolName,
      });

      await this.emit(interrupt.sessionId, 'tool:result', {
        toolName,
        result,
      });

      // Continue run with the tool result
      return this.run({
        sessionId: interrupt.sessionId,
        prompt: `Continue after tool "${toolName}" executed with result: ${JSON.stringify(result)}`,
      });
    } catch (err: any) {
      const errorMsg = err.message || 'Tool execution failed';
      await this.emit(interrupt.sessionId, 'tool:result', {
        toolName,
        error: errorMsg,
      });
      await this.store.updateSessionStatus(interrupt.sessionId, 'failed');
      return {
        sessionId: interrupt.sessionId,
        status: 'failed',
        error: errorMsg,
        usage: { stepsTaken: 0, tokensUsed: 0, elapsedMs: 0 },
      };
    }
  }

  protected checkApprovalRule(toolName: string, args: Record<string, unknown>): ApprovalRule | undefined {
    if (!this.config.approvalRules) return undefined;
    return this.config.approvalRules.find((rule) => {
      if (rule.toolName !== toolName) return false;
      if (rule.condition) return rule.condition(args);
      return true;
    });
  }

  protected async emit(
    sessionId: string,
    type: NewAgentEvent['type'],
    payload: Record<string, unknown>,
  ) {
    return this.store.appendEvent({
      sessionId,
      type,
      payload,
    });
  }
}
