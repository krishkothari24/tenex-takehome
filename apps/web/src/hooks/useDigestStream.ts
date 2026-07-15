import { useCallback, useEffect, useRef, useState } from 'react';
import type { Digest, DigestStreamEvent } from '@inbox-concierge/shared';
import { api } from '../api/client';

export type DigestStatus = 'idle' | 'running' | 'done' | 'error';

export interface DigestStreamState {
  status: DigestStatus;
  inputEmailCount: number;
  digest: Digest | null;
  errorMessage: string | null;
}

const initialState: DigestStreamState = {
  status: 'idle',
  inputEmailCount: 0,
  digest: null,
  errorMessage: null,
};

/**
 * Drives the on-demand `POST /api/digest` SSE stream — cloned from `useClassifyStream`'s state
 * machine (`status`, `abortRef`, event-union reducer) rather than inventing a new shape, since the
 * two hooks share the exact same lifecycle even though the digest stream carries only two frames
 * (`started`, then `done`/`error`) instead of per-batch progress.
 */
export function useDigestStream() {
  const [state, setState] = useState<DigestStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...initialState, status: 'running' });

    try {
      for await (const event of api.digestStream(controller.signal)) {
        applyEvent(event);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Digest generation failed.',
      }));
    }

    function applyEvent(event: DigestStreamEvent) {
      setState((prev) => {
        switch (event.type) {
          case 'started':
            return { ...prev, inputEmailCount: event.inputEmailCount };
          case 'done':
            return { ...prev, status: 'done', digest: event.digest };
          case 'error':
            return { ...prev, status: 'error', errorMessage: event.message };
          default:
            return prev;
        }
      });
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => stop, [stop]);

  return { ...state, start, stop };
}
