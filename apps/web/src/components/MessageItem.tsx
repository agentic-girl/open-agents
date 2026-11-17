import React, { useState } from 'react';
import { User, Brain, Wrench, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { AgentEvent } from '../types';

interface MessageGroupProps {
  events: AgentEvent[];
}

export const MessageFeed: React.FC<MessageGroupProps> = ({ events }) => {
  return (
    <div className="space-y-4 max-w-3xl mx-auto py-6">
      {events.map((event) => (
        <EventCard key={`${event.sessionId}-${event.offset}`} event={event} />
      ))}
    </div>
  );
};

const EventCard: React.FC<{ event: AgentEvent }> = ({ event }) => {
  const [expanded, setExpanded] = useState(false);

  switch (event.type) {
    case 'agent:started':
      return (
        <div className="flex items-start space-x-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800/80">
          <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300">
            <User className="w-4 h-4" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              User Prompt
            </div>
            <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">
              {event.payload.prompt as string}
            </div>
          </div>
        </div>
      );

    case 'agent:thought':
      return (
        <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/50 p-2.5 text-xs text-zinc-400">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center space-x-2 w-full text-left font-mono text-[11px] hover:text-zinc-300"
          >
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-zinc-300">Agent Reasoning</span>
            <span className="text-zinc-400 text-[10px]">
              (offset #{event.offset})
            </span>
            {expanded ? (
              <ChevronDown className="w-3 h-3 ml-auto opacity-60" />
            ) : (
              <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
            )}
          </button>
          {expanded && (
            <div className="mt-2 text-zinc-300 pl-5 border-l-2 border-purple-500/30 text-xs italic leading-relaxed whitespace-pre-wrap">
              {event.payload.thought as string}
            </div>
          )}
        </div>
      );

    case 'tool:called':
      return (
        <div className="rounded-lg bg-[#141418] border border-zinc-800 p-3 text-xs space-y-1.5 font-mono">
          <div className="flex items-center justify-between text-zinc-400">
            <div className="flex items-center space-x-2">
              <Wrench className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-zinc-300 font-semibold">{event.payload.toolName as string}</span>
            </div>
            <span className="text-[10px] text-zinc-400">Executing...</span>
          </div>
          {event.payload.toolArgs && (
            <pre className="text-[11px] text-zinc-400 bg-zinc-950/60 p-2 rounded border border-zinc-800/80 overflow-x-auto">
              {JSON.stringify(event.payload.toolArgs, null, 2)}
            </pre>
          )}
        </div>
      );

    case 'tool:result':
      return (
        <div className="rounded-lg bg-emerald-950/10 border border-emerald-500/20 p-3 text-xs space-y-1.5 font-mono">
          <div className="flex items-center justify-between text-emerald-400 text-[11px]">
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Tool Output ({event.payload.toolName as string})</span>
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-emerald-500 hover:text-emerald-400 underline"
            >
              {expanded ? 'Collapse' : 'Inspect'}
            </button>
          </div>
          {expanded && (
            <pre className="text-[11px] text-zinc-300 bg-zinc-950/80 p-2 rounded border border-zinc-800 overflow-x-auto">
              {JSON.stringify(event.payload.result, null, 2)}
            </pre>
          )}
        </div>
      );

    case 'agent:message':
      return (
        <div className="bg-zinc-900/90 rounded-xl p-4 border border-zinc-800 text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap shadow-sm">
          {event.payload.text as string}
        </div>
      );

    case 'agent:completed':
      return (
        <div className="rounded-xl bg-zinc-900 border border-emerald-500/30 p-4 space-y-2">
          <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Agent Workflow Completed</span>
          </div>
          {event.payload.output && (
            <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">
              {event.payload.output as string}
            </div>
          )}
          {event.payload.usage && (
            <div className="pt-2 flex items-center space-x-4 text-[10px] font-mono text-zinc-400 border-t border-zinc-800/80">
              <span>Steps: {(event.payload.usage as any).stepsTaken}</span>
              <span>Tokens: {(event.payload.usage as any).tokensUsed}</span>
              <span>Time: {(event.payload.usage as any).elapsedMs}ms</span>
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
};
