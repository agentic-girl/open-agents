import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  FolderOpen,
  PanelLeftOpen,
  Radio,
  Square,
  SquarePen,
} from 'lucide-react';
import { BlockList } from './components/BlockList';
import { Sidebar } from './components/Sidebar';
import { useSessionBroadcast } from './hooks/useSessionBroadcast';
import type { HarnessMetadata, Session } from './types';

function readUrlSessionId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('s');
}

function writeUrlSessionId(sessionId: string | null): void {
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set('s', sessionId);
  } else {
    url.searchParams.delete('s');
  }
  window.history.replaceState({}, '', url);
}

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    readUrlSessionId(),
  );
  const [harnesses, setHarnesses] = useState<HarnessMetadata[]>([]);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string>('claude');
  const [selectedModel, setSelectedModel] = useState<string>('claude-sonnet-5-5');
  const [promptInput, setPromptInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: Session[] };
      setSessions(data.sessions);
    } catch {
      // Ignore transient network errors
    }
  }, []);

  const {
    blocks,
    status,
    latestSeq,
    receiverMode,
    error,
    submitPrompt,
    abortTurn,
  } = useSessionBroadcast(activeSessionId, refreshSessions);

  // Load harnesses & initial sessions, plus lightweight sidebar refresh for multi-tab visibility
  useEffect(() => {
    fetch('/api/harnesses')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { harnesses: HarnessMetadata[] } | null) => {
        if (data?.harnesses && data.harnesses.length > 0) {
          setHarnesses(data.harnesses);
          const first = data.harnesses[0]!;
          setSelectedHarnessId(first.id);
          setSelectedModel(first.defaultModel);
        }
      })
      .catch(() => {});

    void refreshSessions();
    const id = window.setInterval(() => {
      void refreshSessions();
    }, 3000);

    const onPopState = () => {
      setActiveSessionId(readUrlSessionId());
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.clearInterval(id);
      window.removeEventListener('popstate', onPopState);
    };
  }, [refreshSessions]);

  // Auto-scroll when new blocks arrive
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blocks.length, status]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [promptInput]);

  const selectSession = (sessionId: string | null) => {
    setActiveSessionId(sessionId);
    writeUrlSessionId(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    if (activeSessionId === sessionId) {
      selectSession(null);
    }
    await refreshSessions();
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = promptInput.trim();
    if (!trimmed || submitting || status === 'running') return;

    setSubmitting(true);
    setPromptInput('');

    try {
      if (!activeSessionId) {
        const createRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            harnessId: selectedHarnessId,
            model: selectedModel,
          }),
        });
        if (!createRes.ok) {
          throw new Error(`Failed to create session (${createRes.status})`);
        }
        const created = (await createRes.json()) as Session;

        const turnRes = await fetch(
          `/api/sessions/${encodeURIComponent(created.id)}/turns`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: trimmed }),
          },
        );
        if (!turnRes.ok) {
          throw new Error(`Failed to start turn (${turnRes.status})`);
        }

        await refreshSessions();
        selectSession(created.id);
      } else {
        await submitPrompt(trimmed);
      }
    } catch (err) {
      console.error('Send error:', err);
      setPromptInput(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeHarness =
    harnesses.find((h) => h.id === selectedHarnessId) ?? harnesses[0];
  const modelChoices = activeHarness?.supportedModels ?? ['claude-sonnet-5-5'];
  const isBusy = submitting || status === 'running';

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#212121]">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => selectSession(id)}
        onNewChat={() => selectSession(null)}
        onDeleteSession={(id) => void handleDeleteSession(id)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top Bar */}
        <header className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-zinc-800/60">
          <div className="flex items-center gap-2 min-w-0">
            {!sidebarOpen && (
              <>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  title="Open sidebar"
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                >
                  <PanelLeftOpen className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => selectSession(null)}
                  title="New chat"
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                >
                  <SquarePen className="w-5 h-5" />
                </button>
              </>
            )}

            {activeSession ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-medium text-sm text-zinc-200 truncate">
                  {activeSession.model}
                </span>
                <span
                  title={activeSession.cwd}
                  className="hidden sm:inline-flex items-center gap-1 text-xs text-zinc-400 font-mono bg-zinc-800/70 px-2 py-0.5 rounded-md max-w-xs truncate"
                >
                  <FolderOpen className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {activeSession.cwd.split('/').slice(-2).join('/')}
                  </span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Select model"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-transparent hover:bg-zinc-800 text-zinc-200 font-medium text-sm rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                >
                  {modelChoices.map((m) => (
                    <option key={m} value={m} className="bg-[#1b1b1b]">
                      {m}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-400 hidden sm:inline">
                  {activeHarness?.displayName ?? 'Claude Agent SDK'}
                </span>
              </div>
            )}
          </div>

          {activeSessionId && (
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                  receiverMode === 'syncing'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : receiverMode === 'reconnecting'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-700/80 bg-zinc-800/60 text-zinc-400'
                }`}
                title="Pull-Initiated Push broadcast status and local sequence watermark"
              >
                <Radio
                  className={`w-3 h-3 ${
                    receiverMode === 'syncing' ? 'animate-pulse' : ''
                  }`}
                />
                <span>seq #{latestSeq}</span>
              </span>
            </div>
          )}
        </header>

        {/* Main Chat / Empty Landing */}
        <main className="flex-1 overflow-y-auto">
          {!activeSessionId || (blocks.length === 0 && !isBusy) ? (
            <div className="h-full flex flex-col items-center justify-center px-4 text-center">
              <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-100 tracking-tight mb-2">
                What would you like to build?
              </h1>
              <p className="text-sm text-zinc-400 max-w-md">
                Powered by{' '}
                <span className="text-zinc-300 font-mono">{selectedModel}</span>{' '}
                in an isolated workspace with durable broadcast streaming.
              </p>
            </div>
          ) : (
            <div>
              <BlockList blocks={blocks} status={status} />
              {error && (
                <div className="max-w-3xl mx-auto px-4 pb-4">
                  <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-2.5 text-xs text-red-300">
                    {error}
                  </div>
                </div>
              )}
              <div ref={scrollEndRef} />
            </div>
          )}
        </main>

        {/* Composer */}
        <footer className="shrink-0 px-4 pb-5 pt-2">
          <form
            onSubmit={(e) => void handleSend(e)}
            className="max-w-3xl mx-auto rounded-3xl bg-[#2f2f2f] border border-zinc-700/60 focus-within:border-zinc-500 px-4 py-3 flex items-end gap-3 shadow-lg"
          >
            <textarea
              ref={textareaRef}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask anything..."
              className="flex-1 bg-transparent text-[15px] leading-6 text-zinc-100 placeholder-zinc-400 focus:outline-none resize-none max-h-[200px]"
            />

            {status === 'running' ? (
              <button
                type="button"
                onClick={() => void abortTurn()}
                title="Stop agent"
                className="w-9 h-9 rounded-full bg-zinc-100 hover:bg-white text-zinc-900 flex items-center justify-center shrink-0 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!promptInput.trim() || isBusy}
                title="Send message"
                className="w-9 h-9 rounded-full bg-zinc-100 hover:bg-white disabled:bg-zinc-700 text-zinc-900 disabled:text-zinc-500 flex items-center justify-center shrink-0 transition-colors"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </form>
        </footer>
      </div>
    </div>
  );
}

export default App;
