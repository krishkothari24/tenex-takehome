import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMessageParam, AgentStreamEvent } from '@inbox-concierge/shared';
import { api } from '../api/client';

export type AgentChatStatus = 'idle' | 'running' | 'done' | 'error';

export type ChatTurn =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; hitIterationCap: boolean }
  | { id: string; kind: 'draft'; threadId: string; draftText: string };

export interface AgentChatStreamState {
  status: AgentChatStatus;
  transcript: ChatTurn[];
  statusText: string | null;
  errorMessage: string | null;
}

const initialState: AgentChatStreamState = {
  status: 'idle',
  transcript: [],
  statusText: null,
  errorMessage: null,
};

function turnId(): string {
  return crypto.randomUUID();
}

/**
 * Drives the `POST /api/agent/chat` SSE stream — same state-machine shape as
 * `useClassifyStream`/`useDigestStream` (status, abortRef, event-union reducer), extended with a
 * `transcript` (UI-facing turns, not the wire format) and a `historyRef` holding the raw
 * `AgentMessageParam[]` the server returned on the last `done` event, which gets resent on the
 * next `send()` — this is the client-held, ephemeral conversation state per
 * docs/AGENTIC_CHAT_PLAN.md's scope decision (no new DB tables). Deliberately not persisted to
 * `localStorage`: this can carry email subjects/snippets, and losing it on reload is expected
 * behavior, not a bug.
 */
export function useAgentChatStream() {
  const [state, setState] = useState<AgentChatStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<AgentMessageParam[]>([]);

  const send = useCallback(async (userMessage: string) => {
    const trimmed = userMessage.trim();
    if (!trimmed || abortRef.current) return; // one turn in flight at a time — mirrors the server's own in-flight guard

    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({
      ...prev,
      status: 'running',
      statusText: null,
      errorMessage: null,
      transcript: [...prev.transcript, { id: turnId(), kind: 'user', text: trimmed }],
    }));

    try {
      for await (const event of api.agentChatStream({ message: trimmed, history: historyRef.current }, controller.signal)) {
        applyEvent(event);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        status: 'error',
        statusText: null,
        errorMessage: err instanceof Error ? err.message : 'Chat request failed.',
      }));
    } finally {
      abortRef.current = null;
    }

    function applyEvent(event: AgentStreamEvent) {
      setState((prev) => {
        switch (event.type) {
          case 'started':
            return prev;
          case 'status':
            return { ...prev, statusText: event.message };
          case 'draft':
            return {
              ...prev,
              transcript: [
                ...prev.transcript,
                { id: turnId(), kind: 'draft', threadId: event.threadId, draftText: event.draftText },
              ],
            };
          case 'done':
            historyRef.current = event.history;
            return {
              ...prev,
              status: 'done',
              statusText: null,
              transcript: [
                ...prev.transcript,
                { id: turnId(), kind: 'assistant', text: event.reply, hitIterationCap: event.hitIterationCap },
              ],
            };
          case 'error':
            return { ...prev, status: 'error', statusText: null, errorMessage: event.message };
          default:
            return prev;
        }
      });
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  return { ...state, send, stop };
}
