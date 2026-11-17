import { useState, useEffect, useRef, useCallback } from 'react';
import { AgentEvent, PendingInterrupt, SessionStatus } from '../types';

export function useAgentSession(sessionId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [pendingInterrupt, setPendingInterrupt] = useState<PendingInterrupt | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const cursorRef = useRef<number>(-1);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state when switching sessions
  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setStatus('idle');
      setPendingInterrupt(null);
      cursorRef.current = -1;
      return;
    }

    setEvents([]);
    setStatus('idle');
    setPendingInterrupt(null);
    cursorRef.current = -1;

    // Start initial sync
    startDeltaSync(sessionId);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [sessionId]);

  const startDeltaSync = useCallback(async (activeSessionId: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsSyncing(true);

    try {
      const url = `/api/sessions/${activeSessionId}/delta?cursor=${cursorRef.current}`;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        setIsSyncing(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.replace('data: ', ''));

                if (data && typeof data.offset === 'number') {
                  const event = data as AgentEvent;
                  if (event.offset > cursorRef.current) {
                    cursorRef.current = event.offset;
                    setEvents((prev) => [...prev, event]);

                    // Update local session state based on event
                    if (event.type === 'agent:started') {
                      setStatus('running');
                      setPendingInterrupt(null);
                    } else if (event.type === 'agent:suspended') {
                      setStatus('suspended');
                      setPendingInterrupt({
                        interruptId: event.payload.interruptId,
                        toolName: event.payload.toolName,
                        toolArgs: event.payload.toolArgs,
                        reason: event.payload.reason,
                      });
                    } else if (event.type === 'agent:resumed') {
                      setStatus('running');
                      setPendingInterrupt(null);
                    } else if (event.type === 'agent:completed') {
                      setStatus('completed');
                      setPendingInterrupt(null);
                    } else if (event.type === 'agent:failed') {
                      setStatus('failed');
                      setPendingInterrupt(null);
                    }
                  }
                }
              } catch (e) {
                console.error('Failed to parse delta chunk:', e);
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Delta transport disconnected. Ready to re-sync on next cursor.', err);
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      if (!sessionId || !prompt.trim()) return;

      setStatus('running');

      const res = await fetch(`/api/sessions/${sessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (res.ok) {
        // Resume delta stream
        startDeltaSync(sessionId);
      }
    },
    [sessionId, startDeltaSync],
  );

  const sendApproval = useCallback(
    async (approved: boolean, feedback?: string) => {
      if (!sessionId || !pendingInterrupt) return;

      const res = await fetch(`/api/sessions/${sessionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interruptId: pendingInterrupt.interruptId,
          approved,
          feedback,
        }),
      });

      if (res.ok) {
        setPendingInterrupt(null);
        setStatus('running');
        startDeltaSync(sessionId);
      }
    },
    [sessionId, pendingInterrupt, startDeltaSync],
  );

  return {
    events,
    status,
    pendingInterrupt,
    cursor: cursorRef.current,
    isSyncing,
    sendPrompt,
    sendApproval,
  };
}
