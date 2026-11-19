import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SessionBlock,
  SessionStatus,
  SessionStatusSnapshot,
  SyncFrame,
} from '../types';

const IDLE_POLL_INTERVAL_MS = 1500;
const RECONNECT_DELAY_MS = 400;

export type ReceiverMode = 'idle' | 'syncing' | 'reconnecting';

export function useSessionBroadcast(
  sessionId: string | null,
  onSessionActivity?: () => void,
) {
  const [blocks, setBlocks] = useState<SessionBlock[]>([]);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [latestSeq, setLatestSeq] = useState<number>(0);
  const [receiverMode, setReceiverMode] = useState<ReceiverMode>('idle');
  const [error, setError] = useState<string | null>(null);

  const seqRef = useRef<number>(0);
  const activeSyncAbortRef = useRef<AbortController | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const currentSessionRef = useRef<string | null>(sessionId);
  currentSessionRef.current = sessionId;

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  /**
   * Initiates a Pull-Initiated Push request (`GET /api/sessions/:id/sync?after=<seq>`).
   * Safe to call redundantly: no-ops if a sync stream is already open for this session.
   */
  const triggerSync = useCallback(
    async (targetSessionId: string) => {
      if (isSyncingRef.current || currentSessionRef.current !== targetSessionId) {
        return;
      }

      clearReconnectTimer();
      isSyncingRef.current = true;
      setReceiverMode('syncing');

      const controller = new AbortController();
      activeSyncAbortRef.current = controller;

      let receivedDoneFrame = false;

      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(targetSessionId)}/sync?after=${seqRef.current}`,
          { signal: controller.signal },
        );

        if (!res.ok) {
          if (res.status === 404) {
            setError('Session not found.');
            receivedDoneFrame = true;
            return;
          }
          throw new Error(`Sync failed with HTTP ${res.status}`);
        }

        setError(null);
        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';

        const processLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line) return;
          const frame = JSON.parse(line) as SyncFrame;

          if (frame.type === 'block') {
            if (frame.block.seq > seqRef.current) {
              seqRef.current = frame.block.seq;
              setLatestSeq(frame.block.seq);
              setBlocks((prev) =>
                prev.some((b) => b.seq === frame.block.seq)
                  ? prev
                  : [...prev, frame.block],
              );
            }
            if (frame.block.payload.kind !== 'turn_result') {
              setStatus('running');
            }
          } else if (frame.type === 'done') {
            receivedDoneFrame = true;
            if (frame.latestSeq > seqRef.current) {
              seqRef.current = frame.latestSeq;
              setLatestSeq(frame.latestSeq);
            }
            setStatus(frame.status);
            onSessionActivity?.();
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            processLine(line);
          }
        }

        if (buffer.trim()) {
          processLine(buffer);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        setReceiverMode('reconnecting');
        setError(err instanceof Error ? err.message : 'Connection interrupted');
      } finally {
        isSyncingRef.current = false;
        if (activeSyncAbortRef.current === controller) {
          activeSyncAbortRef.current = null;
        }

        if (
          !controller.signal.aborted &&
          currentSessionRef.current === targetSessionId
        ) {
          if (!receivedDoneFrame) {
            // Stream closed mid-turn (e.g. proxy timeout or network blip) -> immediately re-pull delta!
            setReceiverMode('reconnecting');
            reconnectTimerRef.current = window.setTimeout(() => {
              void triggerSync(targetSessionId);
            }, RECONNECT_DELAY_MS);
          } else {
            setReceiverMode('idle');
          }
        }
      }
    },
    [onSessionActivity],
  );

  // Hydrate when switching sessions
  useEffect(() => {
    clearReconnectTimer();
    activeSyncAbortRef.current?.abort();
    activeSyncAbortRef.current = null;
    isSyncingRef.current = false;

    seqRef.current = 0;
    setBlocks([]);
    setLatestSeq(0);
    setStatus('idle');
    setReceiverMode('idle');
    setError(null);

    if (!sessionId) return;

    void triggerSync(sessionId);

    // Lightweight status poll while idle so passive tabs tune in automatically when a broadcast starts
    const intervalId = window.setInterval(async () => {
      if (isSyncingRef.current || currentSessionRef.current !== sessionId) {
        return;
      }

      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/status`,
        );
        if (!res.ok) return;
        const snap = (await res.json()) as SessionStatusSnapshot;
        if (snap.status === 'running' || snap.latestSeq > seqRef.current) {
          setStatus(snap.status);
          void triggerSync(sessionId);
        } else if (snap.status !== status) {
          setStatus(snap.status);
        }
      } catch {
        // Ignore transient offline blips during idle poll
      }
    }, IDLE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      clearReconnectTimer();
      activeSyncAbortRef.current?.abort();
      activeSyncAbortRef.current = null;
      isSyncingRef.current = false;
    };
  }, [sessionId, triggerSync]);

  const submitPrompt = useCallback(
    async (prompt: string, overrideSessionId?: string) => {
      const targetId = overrideSessionId ?? sessionId;
      if (!targetId) return;

      setError(null);
      setStatus('running');

      const res = await fetch(
        `/api/sessions/${encodeURIComponent(targetId)}/turns`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        },
      );

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = payload.error ?? `Failed to submit turn (${res.status})`;
        setError(msg);
        setStatus('idle');
        throw new Error(msg);
      }

      onSessionActivity?.();
      void triggerSync(targetId);
    },
    [sessionId, triggerSync, onSessionActivity],
  );

  const abortTurn = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
    });
  }, [sessionId]);

  return {
    blocks,
    status,
    latestSeq,
    receiverMode,
    error,
    submitPrompt,
    abortTurn,
  };
}
