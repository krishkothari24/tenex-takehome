import type {
  BucketsResponse,
  ClassifyStreamEvent,
  EmailsResponse,
  InboxSyncResponse,
  SessionUser,
} from '@inbox-concierge/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (res.status === 401) {
    throw new UnauthenticatedError();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request to ${path} failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthenticatedError';
  }
}

export const api = {
  me: () => request<SessionUser>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  syncInbox: () => request<InboxSyncResponse>('/api/inbox/sync'),
  listBuckets: () => request<BucketsResponse>('/api/buckets'),
  listEmails: () => request<EmailsResponse>('/api/emails'),
  classifyStream,
};

/**
 * `POST /api/classify` is a mutating, side-effecting call (it persists classification rows), so
 * it's consumed via `fetch()` + a manual `ReadableStream` reader rather than `EventSource` —
 * `EventSource` only supports GET and can't express that. Parses SSE `data: ...\n\n` frames by
 * hand and yields one parsed `ClassifyStreamEvent` per frame as they arrive.
 */
async function* classifyStream(signal: AbortSignal | null = null): AsyncGenerator<ClassifyStreamEvent> {
  const res = await fetch('/api/classify', { method: 'POST', credentials: 'include', signal });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok || !res.body) {
    throw new Error(`Classify request failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine) {
          yield JSON.parse(dataLine.slice('data: '.length)) as ClassifyStreamEvent;
        }
        frameEnd = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
