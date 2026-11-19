import React from 'react';
import {
  MessageSquare,
  PanelLeftClose,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { Session } from '../types';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  open,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
}) => {
  if (!open) return null;

  return (
    <aside className="w-64 shrink-0 bg-[#171717] border-r border-zinc-800/80 flex flex-col h-full select-none">
      <div className="h-14 px-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          title="Close sidebar"
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <PanelLeftClose className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <SquarePen className="w-5 h-5" />
        </button>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800/80 transition-colors"
        >
          <SquarePen className="w-4 h-4 text-zinc-400" />
          <span>New chat</span>
        </button>
      </div>

      <div className="px-4 pt-2 pb-1.5 text-[11px] font-medium text-zinc-400">
        Sessions
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-4">
        {sessions.length === 0 ? (
          <div className="px-3 py-6 text-xs text-zinc-400">
            No conversations yet
          </div>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors ${
                  active
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
                onClick={() => onSelectSession(session.id)}
              >
                {session.status === 'running' ? (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
                <span className="truncate flex-1 text-[13px]">
                  {session.title}
                </span>
                <button
                  type="button"
                  title="Delete session"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
