import type {
  BucketsResponse,
  ClassifyStreamEvent,
  CreateBucketResponse,
  DashboardAnalytics,
  DigestResponse,
  DigestStreamEvent,
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
  getAnalytics: () => request<DashboardAnalytics>('/api/analytics'),
  createBucket: (name: string) =>
    request<CreateBucketResponse>('/api/buckets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  classifyStream: (signal: AbortSignal | null = null) => streamPost<ClassifyStreamEvent>('/api/classify', signal),
  reclassifyStream: (signal: AbortSignal | null = null) => streamPost<ClassifyStreamEvent>('/api/reclassify', signal),
  getDigest: () => request<DigestResponse>('/api/digest'),
  digestStream: (signal: AbortSignal | null = null) => streamPost<DigestStreamEvent>('/api/digest', signal),
};

/**
 * `/api/classify`, `/api/reclassify`, and `/api/digest` are all mutating, side-effecting calls
 * (they persist rows and, for digest, spend real API budget), so they're consumed via `fetch()` +
 * a manual `ReadableStream` reader rather than `EventSource` — `EventSource` only supports GET and
 * can't express that. Generic over the event union so the frame-parsing logic isn't duplicated
 * across streams that share this shape but not their event types.
 */
async function* streamPost<T>(path: string, signal: AbortSignal | null): AsyncGenerator<T> {
  const res = await fetch(path, { method: 'POST', credentials: 'include', signal });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok || !res.body) {
    throw new Error(`Request to ${path} failed with status ${res.status}`);
  }
  yield* parseSSEFrames<T>(res);
}

async function* parseSSEFrames<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.getReader();
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
          yield JSON.parse(dataLine.slice('data: '.length)) as T;
        }
        frameEnd = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
