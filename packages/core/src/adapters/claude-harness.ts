import Anthropic from '@anthropic-ai/sdk';
import { BaseAgentHarness, StepAction } from '../harness/base-harness.js';
import { HarnessConfig, HarnessUsage } from '../types/index.js';
import { EventStore } from '../store/event-store.js';

export interface ClaudeHarnessConfig extends HarnessConfig {
  apiKey?: string;
  defaultModel?: string;
}

export class ClaudeAgentHarness extends BaseAgentHarness {
  private client: Anthropic;
  private model: string;

  constructor(config: ClaudeHarnessConfig, store: EventStore) {
    super(config, store);
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = config.model || config.defaultModel || 'claude-3-5-sonnet-20241022';
  }

  protected async executeStep(
    sessionId: string,
    history: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>,
    usage: HarnessUsage,
  ): Promise<StepAction> {
    const anthropicTools = this.toolRegistry.toAnthropicTools();

    // Map history to Anthropic Messages format
    const messages: Anthropic.MessageParam[] = [];

    for (const item of history) {
      if (item.role === 'user') {
        messages.push({
          role: 'user',
          content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
        });
      } else if (item.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
        });
      } else if (item.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: `tool_${Date.now()}`,
              content: JSON.stringify(item.content),
            },
          ],
        });
      }
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: this.config.instructions,
        messages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools as any } : {}),
      });

      // Track token usage
      if (response.usage) {
        usage.tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
      }

      // Check for tool calls
      const toolUseBlock = response.content.find((block) => block.type === 'tool_use') as
        | Anthropic.ToolUseBlock
        | undefined;

      if (toolUseBlock) {
        return {
          type: 'tool_call',
          toolName: toolUseBlock.name,
          toolArgs: (toolUseBlock.input as Record<string, unknown>) || {},
        };
      }

      // Extract text content
      const textBlocks = response.content
        .filter((block) => block.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('\n');

      if (response.stop_reason === 'end_turn') {
        return {
          type: 'complete',
          content: textBlocks,
        };
      }

      return {
        type: 'message',
        content: textBlocks,
      };
    } catch (err: any) {
      throw new Error(`Claude API call failed: ${err.message}`);
    }
  }
}
