import { describe, expect, it, vi } from 'vitest';
import type { BlockPayload } from '@open-agents/core';

let capturedParams: unknown = null;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: unknown) => {
    capturedParams = params;
    async function* fakeStream() {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'claude_sdk_sess_99',
      };
      yield {
        type: 'assistant',
        session_id: 'claude_sdk_sess_99',
        message: {
          content: [
            { type: 'thinking', thinking: 'Inspecting workspace directory...' },
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'Bash',
              input: { command: 'pwd' },
            },
          ],
        },
      };
      yield {
        type: 'user',
        session_id: 'claude_sdk_sess_99',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01',
              content: '/tmp/workspace\n',
              is_error: false,
            },
          ],
        },
      };
      yield {
        type: 'assistant',
        session_id: 'claude_sdk_sess_99',
        message: {
          content: [{ type: 'text', text: 'Current directory is /tmp/workspace.' }],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'claude_sdk_sess_99',
        duration_ms: 850,
        total_cost_usd: 0.012,
        usage: { input_tokens: 300, output_tokens: 90 },
      };
    }
    return fakeStream();
  },
}));

import { ClaudeHarnessAdapter, DEFAULT_CLAUDE_MODEL } from '../src/index.js';

describe('ClaudeHarnessAdapter', () => {
  it('defaults to claude-sonnet-5-5 in bypassPermissions mode and normalizes SDK frames', async () => {
    const adapter = new ClaudeHarnessAdapter();
    expect(adapter.defaultModel).toBe('claude-sonnet-5-5');
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-5-5');

    const emitted: BlockPayload[] = [];
    let recordedSessionId: string | null = null;

    await adapter.runTurn({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      prompt: 'Where am I?',
      cwd: '/tmp/workspace',
      model: adapter.defaultModel,
      harnessSessionId: 'prev_sdk_session',
      signal: new AbortController().signal,
      onHarnessSessionId: async (id) => {
        recordedSessionId = id;
      },
      emit: async (payload) => {
        emitted.push(payload);
        return {
          seq: emitted.length,
          id: `blk_${emitted.length}`,
          sessionId: 'sess_1',
          turnId: 'turn_1',
          createdAt: new Date().toISOString(),
          payload,
        };
      },
    });

    const params = capturedParams as {
      prompt: string;
      options: Record<string, unknown>;
    };
    expect(params.prompt).toBe('Where am I?');
    expect(params.options.model).toBe('claude-sonnet-5-5');
    expect(params.options.permissionMode).toBe('bypassPermissions');
    expect(params.options.allowDangerouslySkipPermissions).toBe(true);
    expect(params.options.includePartialMessages).toBe(false);
    expect(params.options.resume).toBe('prev_sdk_session');
    expect(recordedSessionId).toBe('claude_sdk_sess_99');

    expect(emitted).toEqual([
      { kind: 'thinking', thinking: 'Inspecting workspace directory...' },
      {
        kind: 'tool_use',
        toolUseId: 'toolu_01',
        toolName: 'Bash',
        input: { command: 'pwd' },
      },
      {
        kind: 'tool_result',
        toolUseId: 'toolu_01',
        toolName: 'Bash',
        output: '/tmp/workspace\n',
        isError: false,
      },
      { kind: 'assistant_message', text: 'Current directory is /tmp/workspace.' },
      {
        kind: 'turn_result',
        outcome: 'completed',
        durationMs: 850,
        costUsd: 0.012,
        inputTokens: 300,
        outputTokens: 90,
      },
    ]);
  });
});
