import React from 'react';
import { Plus, MessageSquare, Bot, ShieldCheck, Terminal, Github } from 'lucide-react';
import { Session } from '../types';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  agents: Array<{ id: string; type: string }>;
  selectedAgent: string;
  onSelectAgent: (agentId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  agents,
  selectedAgent,
  onSelectAgent,
}) => {
  return (
    <aside className="w-64 bg-[#121215] border-r border-zinc-800 flex flex-col h-screen select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
            OA
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-tight text-zinc-100">OpenAgents</h1>
            <p className="text-[10px] text-zinc-400 font-mono">Durable Agent Runtime</p>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Agent Session</span>
        </button>
      </div>

      {/* Agent Selector */}
      <div className="px-3 pb-3">
        <label className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 px-1 mb-1 block">
          Agent Harness
        </label>
        <div className="relative">
          <select
            value={selectedAgent}
            onChange={(e) => onSelectAgent(e.target.value)}
            className="w-full bg-[#18181c] border border-zinc-700/80 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.id} ({agent.type})
              </option>
            ))}
          </select>
          <Bot className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 px-1 py-1">
          Recent Sessions
        </div>
        {sessions.length === 0 ? (
          <div className="text-xs text-zinc-400 px-2 py-4 text-center">No sessions yet</div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                  isActive
                    ? 'bg-zinc-800/90 text-white font-medium border border-zinc-700'
                    : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate flex-1 font-mono text-[11px]">{s.id}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    s.status === 'running'
                      ? 'bg-emerald-400 animate-pulse'
                      : s.status === 'suspended'
                        ? 'bg-amber-400 animate-ping'
                        : 'bg-zinc-600'
                  }`}
                />
              </button>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-zinc-800/80 bg-[#101013] space-y-2">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Harness Guardrails</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
            Active
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <div className="flex items-center space-x-1.5">
            <Terminal className="w-3.5 h-3.5 text-zinc-400" />
            <span>Transport</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-300">Delta-Sync</span>
        </div>
        <div className="pt-1 flex items-center justify-center">
          <a
            href="https://github.com/agentic-girl/open-agents"
            target="_blank"
            rel="noreferrer"
            className="flex items-center space-x-1.5 text-zinc-400 hover:text-zinc-200 text-xs py-1"
          >
            <Github className="w-3.5 h-3.5" />
            <span>GitHub Repository</span>
          </a>
        </div>
      </div>
    </aside>
  );
};
