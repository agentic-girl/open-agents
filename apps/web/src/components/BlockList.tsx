import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  SquareTerminal,
} from 'lucide-react';
import type { BlockPayload, SessionBlock, SessionStatus } from '../types';
import { MarkdownContent } from './MarkdownContent';

interface BlockListProps {
  blocks: SessionBlock[];
  status: SessionStatus;
}

export const BlockList: React.FC<BlockListProps> = ({ blocks, status }) => {
  // Index tool_result payloads by toolUseId so each tool_use renders as a unified step card
  const toolResultsByUseId = useMemo(() => {
    const map = new Map<
      string,
      Extract<BlockPayload, { kind: 'tool_result' }>
    >();
    for (const block of blocks) {
      if (block.payload.kind === 'tool_result') {
        map.set(block.payload.toolUseId, block.payload);
      }
    }
    return map;
  }, [blocks]);

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">
      {blocks.map((block) => {
        const { payload } = block;

        if (payload.kind === 'user_message') {
          return (
            <div key={block.seq} className="flex justify-end pt-2">
              <div className="max-w-[82%] rounded-3xl bg-[#2f2f2f] px-5 py-3 text-[15px] leading-7 text-zinc-100 whitespace-pre-wrap break-words">
                {payload.text}
              </div>
            </div>
          );
        }

        if (payload.kind === 'thinking') {
          return (
            <ThinkingBlockCard key={block.seq} thinking={payload.thinking} />
          );
        }

        if (payload.kind === 'tool_use') {
          const result = toolResultsByUseId.get(payload.toolUseId);
          return (
            <ToolStepCard
              key={block.seq}
              toolName={payload.toolName}
              input={payload.input}
              result={result}
              sessionRunning={status === 'running'}
            />
          );
        }

        if (payload.kind === 'tool_result') {
          // Rendered inline inside its paired ToolStepCard unless orphaned
          const hasMatchingUse = blocks.some(
            (b) =>
              b.payload.kind === 'tool_use' &&
              b.payload.toolUseId === payload.toolUseId,
          );
          if (hasMatchingUse) return null;
          return (
            <ToolStepCard
              key={block.seq}
              toolName={payload.toolName ?? 'Tool'}
              input={null}
              result={payload}
              sessionRunning={false}
            />
          );
        }

        if (payload.kind === 'assistant_message') {
          return (
            <div key={block.seq} className="py-1">
              <MarkdownContent content={payload.text} />
            </div>
          );
        }

        if (payload.kind === 'turn_result') {
          return <TurnResultFooter key={block.seq} result={payload} />;
        }

        return null;
      })}

      {status === 'running' && (
        <div className="flex items-center gap-2.5 text-sm text-zinc-400 py-2">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
          <span>Agent is working...</span>
        </div>
      )}
    </div>
  );
};

const ThinkingBlockCard: React.FC<{ thinking: string }> = ({ thinking }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-zinc-800/90 bg-[#1a1a1a] px-3.5 py-2.5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="font-medium">Reasoning</span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        )}
      </button>
      {open && (
        <div className="mt-2.5 pl-5 border-l border-zinc-700 text-zinc-300 whitespace-pre-wrap leading-relaxed">
          {thinking}
        </div>
      )}
    </div>
  );
};

const ToolStepCard: React.FC<{
  toolName: string;
  input: unknown;
  result?: Extract<BlockPayload, { kind: 'tool_result' }>;
  sessionRunning: boolean;
}> = ({ toolName, input, result, sessionRunning }) => {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(toolName, input);

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#181818] overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-800/40 transition-colors"
      >
        {!result && sessionRunning ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
        ) : result?.isError ? (
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        )}

        <SquareTerminal className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="font-mono font-medium text-zinc-200">{toolName}</span>
        {summary && (
          <span className="font-mono text-zinc-400 truncate flex-1">
            {summary}
          </span>
        )}
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0 ml-auto" />
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3.5 space-y-3 bg-[#131313] font-mono text-[12px]">
          {input !== null && input !== undefined && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 font-sans">
                Input
              </div>
              <pre className="text-zinc-300 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {result && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 font-sans">
                {result.isError ? 'Error Output' : 'Output'}
              </div>
              <pre
                className={`whitespace-pre-wrap break-all max-h-72 overflow-y-auto ${
                  result.isError ? 'text-red-300' : 'text-zinc-300'
                }`}
              >
                {result.output || '(empty output)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const TurnResultFooter: React.FC<{
  result: Extract<BlockPayload, { kind: 'turn_result' }>;
}> = ({ result }) => {
  if (result.outcome === 'error') {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200 flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-medium text-red-300">Turn failed</div>
          {result.errorMessage && (
            <div className="text-xs text-red-200/90 whitespace-pre-wrap font-mono">
              {result.errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  const seconds = (result.durationMs / 1000).toFixed(1);
  const parts: string[] = [
    result.outcome === 'aborted' ? `Stopped after ${seconds}s` : `${seconds}s`,
  ];

  if (result.inputTokens !== undefined || result.outputTokens !== undefined) {
    parts.push(
      `${result.inputTokens ?? 0} in / ${result.outputTokens ?? 0} out tokens`,
    );
  }
  if (result.costUsd !== undefined) {
    parts.push(`$${result.costUsd.toFixed(4)}`);
  }

  return (
    <div className="text-[11px] text-zinc-400 font-mono pb-2">
      {parts.join(' · ')}
    </div>
  );
};

function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  if (typeof obj.command === 'string') return obj.command;
  if (typeof obj.file_path === 'string') return obj.file_path;
  if (typeof obj.path === 'string') return obj.path;
  if (typeof obj.pattern === 'string') return obj.pattern;
  if (typeof obj.url === 'string') return obj.url;
  if (typeof obj.query === 'string') return obj.query;
  const keys = Object.keys(obj);
  if (keys.length === 0 || toolName.length === 0) return '';
  return JSON.stringify(obj);
}
