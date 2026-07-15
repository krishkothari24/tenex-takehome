import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClassifyStreamEvent, CostEstimateDto, EmailClassification } from '@inbox-concierge/shared';
import { api } from '../api/client';

export type ClassifyStatus = 'idle' | 'running' | 'done' | 'error';

export interface ClassifyStreamState {
  status: ClassifyStatus;
  estimate: CostEstimateDto | null;
  batchCount: number;
  completedBatches: number;
  classifications: Map<string, EmailClassification>;
  unclassifiedEmailIds: string[];
  errorMessage: string | null;
}

const initialState: ClassifyStreamState = {
  status: 'idle',
  estimate: null,
  batchCount: 0,
  completedBatches: 0,
  classifications: new Map(),
  unclassifiedEmailIds: [],
  errorMessage: null,
};

type StreamFn = (signal: AbortSignal) => AsyncGenerator<ClassifyStreamEvent>;

/**
 * Drives an SSE classification stream and exposes incremental state so the UI can render cards as
 * each batch completes rather than blocking on the full run (build guide §2's "live reflow must
 * feel fast and alive, not a spinner-then-refresh"). Defaults to `/api/classify` (first-load
 * classify); pass `api.reclassifyStream` to drive the same state machine for the custom-bucket
 * reflow instead — both emit the identical `ClassifyStreamEvent` union, so no new state shape or
 * hook is needed for the second stream.
 */
export function useClassifyStream() {
  const [state, setState] = useState<ClassifyStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (streamFn: StreamFn = api.classifyStream) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...initialState, status: 'running' });

    try {
      for await (const event of streamFn(controller.signal)) {
        applyEvent(event);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Classification stream failed.',
      }));
    }

    function applyEvent(event: ClassifyStreamEvent) {
      setState((prev) => {
        switch (event.type) {
          case 'estimate':
            return { ...prev, estimate: event.estimate, batchCount: event.batchCount };
          case 'batch': {
            const classifications = new Map(prev.classifications);
            for (const c of event.classifications) classifications.set(c.emailId, c);
            return {
              ...prev,
              completedBatches: prev.completedBatches + 1,
              classifications,
              unclassifiedEmailIds: [...prev.unclassifiedEmailIds, ...event.unclassifiedEmailIds],
            };
          }
          case 'done':
            return { ...prev, status: 'done' };
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
