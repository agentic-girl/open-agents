import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, RefreshCw, Layers } from 'lucide-react';
import { useAgentSession } from '../hooks/useAgentSession';
import { MessageFeed } from './MessageItem';
import { ApprovalBanner } from './ApprovalBanner';

interface ChatViewProps {
  sessionId: string | null;
}

export const ChatView: React.FC<ChatViewProps> = ({ sessionId }) => {
  const {
    events,
    status,
    pendingInterrupt,
    cursor,
    isSyncing,
    sendPrompt,
    sendApproval,
  } = useAgentSession(sessionId);

  const [inputPrompt, setInputPrompt] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, pendingInterrupt]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPrompt.trim() || status === 'running') return;
    sendPrompt(inputPrompt.trim());
    setInputPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!sessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0e0e11]">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
          <Layers className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-200">No Active Session</h2>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm">
          Select an existing session from the sidebar or click &ldquo;New Agent Session&rdquo; to test durable agent execution.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#0e0e11] overflow-hidden">
      {/* Top Header Bar */}
      <header className="h-14 border-b border-zinc-800/80 px-6 flex items-center justify-between bg-[#111114]/80 backdrop-blur-sm z-10">
        <div className="flex items-center space-x-3">
          <span className="font-mono text-xs text-zinc-300 font-semibold">{sessionId}</span>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
              status === 'running'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : status === 'suspended'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            {status}
          </span>
        </div>

        <div className="flex items-center space-x-3 text-[11px] font-mono text-zinc-400">
          <div className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-md">
            <span>Durable Cursor:</span>
            <span className="text-emerald-400 font-bold">#{cursor}</span>
          </div>

          <div className="flex items-center space-x-1 text-zinc-400">
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Connected'}</span>
          </div>
        </div>
      </header>

      {/* Main Conversation Feed */}
      <main className="flex-1 overflow-y-auto px-6">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto py-12">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Ready for Agent Tasks</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Enter an instruction or try a preconfigured DevOps scenario below.
              </p>
            </div>

            <div className="w-full space-y-2 pt-2">
              <button
                onClick={() =>
                  setInputPrompt('Deploy payment-gateway to production with tag v2.4.1')
                }
                className="w-full text-left p-3 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/80 text-xs text-zinc-300 transition-colors"
              >
                <div className="font-semibold text-emerald-400">Production Deploy (Approval Gate)</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  &ldquo;Deploy payment-gateway to production with tag v2.4.1&rdquo;
                </div>
              </button>

              <button
                onClick={() =>
                  setInputPrompt('Run a read-only query on warehouse database for active enterprise users')
                }
                className="w-full text-left p-3 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/80 text-xs text-zinc-300 transition-colors"
              >
                <div className="font-semibold text-blue-400">Database Query (Safe Tool)</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  &ldquo;Run a read-only query on warehouse database for active enterprise users&rdquo;
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="pb-8">
            <MessageFeed events={events} />

            {pendingInterrupt && (
              <div className="max-w-3xl mx-auto">
                <ApprovalBanner
                  interrupt={pendingInterrupt}
                  onApprove={(approved, feedback) => sendApproval(approved, feedback)}
                />
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </main>

      {/* Bottom Prompt Input */}
      <footer className="p-4 border-t border-zinc-800/80 bg-[#101013]/90 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
          <textarea
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === 'running' || status === 'suspended'}
            placeholder={
              status === 'suspended'
                ? 'Agent suspended pending human approval above...'
                : status === 'running'
                  ? 'Agent working in background durable worker...'
                  : 'Message OpenAgents (e.g. Deploy payment-gateway to production)...'
            }
            rows={2}
            className="w-full bg-[#16161a] border border-zinc-700/80 focus:border-emerald-500 rounded-xl px-4 py-3 pr-12 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none resize-none transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputPrompt.trim() || status === 'running' || status === 'suspended'}
            className="absolute right-3 bottom-5 p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white disabled:text-zinc-400 transition-colors shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>
    </div>
  );
};
