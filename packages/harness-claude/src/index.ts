import {
  type McpServerConfig,
  type Options as ClaudeSdkOptions,
  type PermissionMode,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { HarnessAdapter, HarnessTurnContext } from '@open-agents/core';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';

export interface ClaudeHarnessOptions {
  id?: string;
  displayName?: string;
  defaultModel?: string;
  supportedModels?: readonly string[];
  apiKey?: string;
  resolveApiKey?: () => Promise<string | undefined> | string | undefined;
  systemPrompt?: string;
  maxTurns?: number;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  additionalDirectories?: string[];
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, string>;
}

const MAX_TOOL_OUTPUT_CHARS = 64_000;

export class ClaudeHarnessAdapter implements HarnessAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly supportedModels: readonly string[];
  private readonly options: ClaudeHarnessOptions;

  constructor(options: ClaudeHarnessOptions = {}) {
    this.options = options;
    this.id = options.id ?? 'claude';
    this.displayName = options.displayName ?? 'Claude Agent SDK';
    this.defaultModel = options.defaultModel ?? DEFAULT_CLAUDE_MODEL;
    this.supportedModels = options.supportedModels ?? [
      'claude-sonnet-5-5',
      'claude-opus-4-6',
      'claude-sonnet-4-5',
    ];
  }

  async runTurn(ctx: HarnessTurnContext): Promise<void> {
    const startTime = Date.now();
    const abortController = new AbortController();

    const onExternalAbort = () => abortController.abort();
    if (ctx.signal.aborted) {
      abortController.abort();
    } else {
      ctx.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const toolNameById = new Map<string, string>();
    let emittedAssistantText = false;
    let emittedTurnResult = false;

    const effectiveSystemPrompt = ctx.systemPrompt ?? this.options.systemPrompt;
    const permissionMode: PermissionMode =
      this.options.permissionMode ?? 'bypassPermissions';
    const dynamicApiKey = await this.options.resolveApiKey?.();

    const sdkOptions: ClaudeSdkOptions = {
      cwd: ctx.cwd,
      model: ctx.model || this.defaultModel,
      permissionMode,
      ...(permissionMode === 'bypassPermissions'
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      includePartialMessages: false,
      abortController,
      env: this.buildSubprocessEnv(dynamicApiKey),
      ...(ctx.harnessSessionId ? { resume: ctx.harnessSessionId } : {}),
      ...(effectiveSystemPrompt ? { systemPrompt: effectiveSystemPrompt } : {}),
      ...(this.options.maxTurns !== undefined ? { maxTurns: this.options.maxTurns } : {}),
      ...(this.options.allowedTools ? { allowedTools: this.options.allowedTools } : {}),
      ...(this.options.mcpServers ? { mcpServers: this.options.mcpServers } : {}),
      ...(this.options.additionalDirectories
        ? { additionalDirectories: this.options.additionalDirectories }
        : {}),
      ...(this.options.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable }
        : {}),
    };

    try {
      const stream = query({
        prompt: ctx.prompt,
        options: sdkOptions,
      });

      for await (const msg of stream) {
        await this.handleSdkMessage(msg, ctx, toolNameById, startTime, {
          markAssistantText: () => {
            emittedAssistantText = true;
          },
          hasEmittedAssistantText: () => emittedAssistantText,
          markTurnResult: () => {
            emittedTurnResult = true;
          },
        });
      }

      if (!emittedTurnResult) {
        await ctx.emit({
          kind: 'turn_result',
          outcome: ctx.signal.aborted ? 'aborted' : 'completed',
          durationMs: Date.now() - startTime,
        });
      }
    } catch (err: unknown) {
      if (emittedTurnResult) return;

      if (ctx.signal.aborted || abortController.signal.aborted) {
        await ctx.emit({
          kind: 'turn_result',
          outcome: 'aborted',
          durationMs: Date.now() - startTime,
        });
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      await ctx.emit({
        kind: 'turn_result',
        outcome: 'error',
        durationMs: Date.now() - startTime,
        errorMessage: message,
      });
    } finally {
      ctx.signal.removeEventListener('abort', onExternalAbort);
    }
  }

  private async handleSdkMessage(
    msg: SDKMessage,
    ctx: HarnessTurnContext,
    toolNameById: Map<string, string>,
    startTime: number,
    tracker: {
      markAssistantText: () => void;
      hasEmittedAssistantText: () => boolean;
      markTurnResult: () => void;
    },
  ): Promise<void> {
    if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
      await ctx.onHarnessSessionId(msg.session_id);
    }

    if (msg.type === 'assistant') {
      const content = (msg as { message?: { content?: unknown[] } }).message?.content;
      if (!Array.isArray(content)) return;

      for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as Record<string, unknown>;

        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          const text = block.thinking.trim();
          if (text) {
            await ctx.emit({ kind: 'thinking', thinking: text });
          }
        } else if (block.type === 'text' && typeof block.text === 'string') {
          const text = block.text.trim();
          if (text) {
            tracker.markAssistantText();
            await ctx.emit({ kind: 'assistant_message', text: block.text });
          }
        } else if (
          block.type === 'tool_use' &&
          typeof block.id === 'string' &&
          typeof block.name === 'string'
        ) {
          toolNameById.set(block.id, block.name);
          await ctx.emit({
            kind: 'tool_use',
            toolUseId: block.id,
            toolName: block.name,
            input: block.input ?? {},
          });
        }
      }
      return;
    }

    if (msg.type === 'user') {
      const userRecord = msg as Record<string, unknown>;
      if (userRecord.isReplay) return;

      const content = (
        msg as { message?: { content?: unknown } }
      ).message?.content;
      if (!Array.isArray(content)) return;

      for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as Record<string, unknown>;

        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const output = formatToolResultContent(block.content);
          const toolName = toolNameById.get(block.tool_use_id);
          await ctx.emit({
            kind: 'tool_result',
            toolUseId: block.tool_use_id,
            ...(toolName ? { toolName } : {}),
            output,
            isError: Boolean(block.is_error),
          });
        }
      }
      return;
    }

    if (msg.type === 'result') {
      const resultMsg = msg as Record<string, unknown>;
      const durationMs =
        typeof resultMsg.duration_ms === 'number'
          ? resultMsg.duration_ms
          : Date.now() - startTime;
      const costUsd =
        typeof resultMsg.total_cost_usd === 'number'
          ? resultMsg.total_cost_usd
          : undefined;
      const usage = resultMsg.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      const inputTokens =
        typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
      const outputTokens =
        typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined;

      if (resultMsg.subtype === 'success') {
        if (
          !tracker.hasEmittedAssistantText() &&
          typeof resultMsg.result === 'string' &&
          resultMsg.result.trim()
        ) {
          tracker.markAssistantText();
          await ctx.emit({
            kind: 'assistant_message',
            text: resultMsg.result,
          });
        }

        tracker.markTurnResult();
        await ctx.emit({
          kind: 'turn_result',
          outcome: 'completed',
          durationMs,
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        });
      } else {
        const errors = Array.isArray(resultMsg.errors)
          ? resultMsg.errors.filter((e): e is string => typeof e === 'string')
          : [];
        const errorMessage =
          errors.join('\n') ||
          (typeof resultMsg.result === 'string' && resultMsg.result) ||
          `Harness finished with status "${String(resultMsg.subtype)}"`;

        tracker.markTurnResult();
        await ctx.emit({
          kind: 'turn_result',
          outcome: ctx.signal.aborted ? 'aborted' : 'error',
          durationMs,
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          errorMessage,
        });
      }
    }
  }

  private buildSubprocessEnv(dynamicApiKey?: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'CLAUDECODE') {
        env[key] = value;
      }
    }
    if (this.options.env) {
      Object.assign(env, this.options.env);
    }
    const apiKey =
      dynamicApiKey ?? this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
    }
    env.CLAUDE_AGENT_SDK_CLIENT_APP = 'open-agents/0.1.0';
    return env;
  }
}

function formatToolResultContent(content: unknown): string {
  let text: string;

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item);
      } else if (
        item &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).type === 'text' &&
        typeof (item as Record<string, unknown>).text === 'string'
      ) {
        parts.push((item as { text: string }).text);
      } else {
        parts.push(JSON.stringify(item));
      }
    }
    text = parts.join('\n');
  } else if (content === null || content === undefined) {
    text = '';
  } else {
    text = JSON.stringify(content, null, 2);
  }

  if (text.length > MAX_TOOL_OUTPUT_CHARS) {
    return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n...[truncated ${text.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
  }
  return text;
}
