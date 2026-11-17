import { query, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { BaseAgentHarness, StepAction } from '../harness/base-harness.js';
import {
  ApprovalDecision,
  HarnessConfig,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessUsage,
} from '../types/index.js';
import { EventStore } from '../store/event-store.js';

export interface ClaudeHarnessConfig extends HarnessConfig {
  apiKey?: string;
  defaultModel?: string;
  permissionMode?: PermissionMode;
  allowDangerouslySkipPermissions?: boolean;
}

export class ClaudeAgentHarness extends BaseAgentHarness {
  private model: string;
  private apiKey?: string;
  private permissionMode: PermissionMode;
  private allowDangerouslySkipPermissions: boolean;

  constructor(config: ClaudeHarnessConfig, store: EventStore) {
    super(config, store);
    // Official Claude Agent SDK model ID
    this.model = config.model || config.defaultModel || 'claude-sonnet-5-5';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    // Default to bypassPermissions mode
    this.permissionMode = config.permissionMode || 'bypassPermissions';
    this.allowDangerouslySkipPermissions = config.allowDangerouslySkipPermissions ?? true;
  }

  /**
   * Base fallback for single-step execution
   */
  protected async executeStep(
    _sessionId: string,
    _history: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>,
    _usage: HarnessUsage,
  ): Promise<StepAction> {
    return { type: 'complete', content: 'Completed.' };
  }

  /**
   * Overrides run() to consume the official Claude Agent SDK query stream directly
   */
  override async run(options: HarnessRunOptions): Promise<HarnessRunResult> {
    const { sessionId, prompt } = options;
    const startTime = Date.now();

    const usage: HarnessUsage = {
      stepsTaken: 0,
      tokensUsed: 0,
      elapsedMs: 0,
    };

    let session = await this.store.getSession(sessionId);
    if (!session) {
      session = await this.store.createSession({
        id: sessionId,
        agentId: this.config.agentId,
      });
    }

    await this.store.updateSessionStatus(sessionId, 'running');

    await this.emit(sessionId, 'agent:started', {
      agentId: this.config.agentId,
      model: this.model,
      prompt,
      limits: this.limits,
    });

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    if (this.apiKey) {
      env.ANTHROPIC_API_KEY = this.apiKey;
    }

    try {
      const q = query({
        prompt,
        options: {
          model: this.model,
          systemPrompt: this.config.instructions,
          maxTurns: this.limits.maxSteps,
          permissionMode: this.permissionMode,
          allowDangerouslySkipPermissions: this.allowDangerouslySkipPermissions,
          env,
        },
      });

      let finalOutput = '';

      for await (const msg of q) {
        usage.elapsedMs = Date.now() - startTime;

        if (msg.type === 'assistant') {
          const assistantMsg = (msg as any).message;
          const contentBlocks = assistantMsg?.content || [];

          for (const block of contentBlocks) {
            // 1. Thinking / Reasoning block
            if (block.type === 'thinking' && block.thinking) {
              await this.emit(sessionId, 'agent:thought', {
                thought: block.thinking,
              });
            }

            // 2. Text response chunk
            if (block.type === 'text' && block.text) {
              finalOutput += block.text;
              await this.emit(sessionId, 'agent:message', {
                text: block.text,
              });
            }

            // 3. Tool invocation block
            if (block.type === 'tool_use') {
              usage.stepsTaken += 1;
              const toolName = block.name;
              const toolArgs = (block.input as Record<string, unknown>) || {};

              // Check human-in-the-loop approval rule
              const triggerRule = this.checkApprovalRule(toolName, toolArgs);

              if (triggerRule) {
                const interruptId = `int_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const interrupt = await this.store.createInterrupt({
                  id: interruptId,
                  sessionId,
                  type: 'tool_approval',
                  toolName,
                  toolArgs,
                  reason:
                    triggerRule.message ||
                    `Approval required before executing tool "${toolName}"`,
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

              // Emit normal tool called
              await this.emit(sessionId, 'tool:called', {
                toolName,
                toolArgs,
              });

              // Execute tool if registered
              if (this.toolRegistry.has(toolName)) {
                try {
                  const result = await this.toolRegistry.execute(toolName, toolArgs, {
                    sessionId,
                    toolName,
                  });
                  await this.emit(sessionId, 'tool:result', {
                    toolName,
                    result,
                  });
                } catch (err: any) {
                  await this.emit(sessionId, 'tool:result', {
                    toolName,
                    error: err.message,
                  });
                }
              }
            }
          }
        }

        // Result / Completion message
        if (msg.type === 'result') {
          await this.emit(sessionId, 'agent:completed', {
            output: finalOutput,
            usage,
          });
          await this.store.updateSessionStatus(sessionId, 'completed');
          return {
            sessionId,
            status: 'completed',
            output: finalOutput,
            usage,
          };
        }
      }

      await this.emit(sessionId, 'agent:completed', {
        output: finalOutput,
        usage,
      });
      await this.store.updateSessionStatus(sessionId, 'completed');
      return {
        sessionId,
        status: 'completed',
        output: finalOutput,
        usage,
      };
    } catch (err: any) {
      const errorMsg = err.message || 'Claude Agent SDK query failed';
      await this.emit(sessionId, 'agent:failed', { error: errorMsg, usage });
      await this.store.updateSessionStatus(sessionId, 'failed');
      return {
        sessionId,
        status: 'failed',
        error: errorMsg,
        usage,
      };
    }
  }

  override async resume(decision: ApprovalDecision): Promise<HarnessRunResult> {
    const interrupt = await this.store.getInterrupt(decision.interruptId);
    if (!interrupt) {
      throw new Error(`Interrupt ${decision.interruptId} not found`);
    }

    await this.store.resolveInterrupt(decision);

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

    const toolName = interrupt.toolName!;
    const toolArgs = decision.modifiedArgs || interrupt.toolArgs || {};

    let toolResult: unknown = { status: 'executed', toolName };
    if (this.toolRegistry.has(toolName)) {
      toolResult = await this.toolRegistry.execute(toolName, toolArgs, {
        sessionId: interrupt.sessionId,
        toolName,
      });
    }

    await this.emit(interrupt.sessionId, 'tool:result', {
      toolName,
      result: toolResult,
    });

    // Resume query loop with the approved tool result
    return this.run({
      sessionId: interrupt.sessionId,
      prompt: `Tool "${toolName}" was approved by operator and executed. Result: ${JSON.stringify(toolResult)}. Complete the request.`,
    });
  }
}

