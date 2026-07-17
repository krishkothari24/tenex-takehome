import { gmail_v1, google } from 'googleapis';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { updateUserTokens, markUserRevoked } from '../db/queries/users.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { createOAuthClient } from './google-oauth.js';
import { extractEmailAddress } from './email-address.js';

const MAX_THREADS = 200;
const LIST_PAGE_SIZE = 100;
const MAX_PAGES = 3;
const FETCH_CONCURRENCY = 8;

export class GmailReauthRequiredError extends Error {
  constructor(message = 'Google access was revoked or expired — user must re-authenticate') {
    super(message);
    this.name = 'GmailReauthRequiredError';
  }
}

interface UserTokenRecord {
  id: string;
  email: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiry: Date;
}

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: number | string; response?: { status?: number } })?.code;
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (code === 401 || status === 401 || code === 'invalid_grant') return true;

  // Google grants sensitive scopes (like gmail.readonly) as individually toggleable consent
  // checkboxes — a user can approve sign-in while leaving Gmail unchecked, which succeeds token
  // exchange but yields a token missing the scope. Surfaces only once the API is actually called,
  // as a 403 rather than 401, and the fix is the same as any other stale-grant case: re-consent.
  const reason = (
    err as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } }
  )?.response?.data?.error?.errors?.[0]?.reason;
  return status === 403 && reason === 'insufficientPermissions';
}

function isRateLimitError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  const reason = (
    err as { errors?: Array<{ reason?: string }> }
  )?.errors?.[0]?.reason;
  return status === 429 || status === 403 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}

async function getAuthenticatedClient(user: UserTokenRecord) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: decryptSecret(user.encryptedAccessToken),
    refresh_token: user.encryptedRefreshToken ? decryptSecret(user.encryptedRefreshToken) : null,
    expiry_date: user.tokenExpiry.getTime(),
  });

  // googleapis silently refreshes the access token when expired; persist any rotation.
  client.on('tokens', (tokens) => {
    void updateUserTokens(user.id, {
      encryptedAccessToken: tokens.access_token
        ? encryptSecret(tokens.access_token)
        : user.encryptedAccessToken,
      ...(tokens.refresh_token ? { encryptedRefreshToken: encryptSecret(tokens.refresh_token) } : {}),
      tokenExpiry: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
    });
  });

  return client;
}

function decodeHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export interface FetchedThread {
  gmailThreadId: string;
  gmailMessageId: string;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  internalDate: Date | null;
  /** Count of messages in the thread and whether any is from the user — powers the dashboard's
   *  "unanswered VIP" heuristic. Computed from data `threads.get` already returns, zero extra calls. */
  messageCount: number;
  hasReplyFromUser: boolean;
  /** True if any message in the thread still carries Gmail's `UNREAD` label — matches Gmail's own
   *  inbox convention of bolding a thread when any message in it is unread. `labelIds` is a
   *  top-level message field Gmail returns even under `format: 'metadata'` (only `payload` fields
   *  are restricted by that format), so this is zero extra API calls too. */
  isUnread: boolean;
}

export interface FetchThreadsResult {
  threads: FetchedThread[];
  failed: string[];
}

async function withRevokeHandling<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAuthError(err)) {
      await markUserRevoked(userId);
      throw new GmailReauthRequiredError();
    }
    throw err;
  }
}

/**
 * Pulls up to MAX_THREADS threads' metadata (subject/from/date/snippet) — never full bodies.
 * Paginates threads.list, bounds threads.get concurrency, retries transient rate-limit errors
 * with backoff, and isolates per-thread failures so one bad thread doesn't fail the whole sync.
 */
export async function fetchRecentThreadsMetadata(user: UserTokenRecord): Promise<FetchThreadsResult> {
  const auth = await getAuthenticatedClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const threadIds: string[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;

  do {
    const { data } = await withRevokeHandling(user.id, () =>
      gmail.users.threads.list({
        userId: 'me',
        maxResults: LIST_PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      }),
    );
    for (const thread of data.threads ?? []) {
      if (thread.id) threadIds.push(thread.id);
      if (threadIds.length >= MAX_THREADS) break;
    }
    pageToken = data.nextPageToken ?? undefined;
    pagesFetched += 1;
  } while (pageToken && threadIds.length < MAX_THREADS && pagesFetched < MAX_PAGES);

  const limit = pLimit(FETCH_CONCURRENCY);
  const failed: string[] = [];

  const results = await Promise.allSettled(
    threadIds.map((threadId) =>
      limit(() =>
        pRetry(
          () =>
            withRevokeHandling(user.id, async () => {
              const { data } = await gmail.users.threads.get({
                userId: 'me',
                id: threadId,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date'],
              });
              const message = data.messages?.[data.messages.length - 1];
              if (!message?.id) {
                throw new Error(`Thread ${threadId} has no messages`);
              }
              const headers = message.payload?.headers;
              const dateHeader = decodeHeader(headers, 'Date');

              const userEmailLower = user.email.toLowerCase();
              const messageCount = data.messages?.length ?? 0;
              const hasReplyFromUser = (data.messages ?? []).some((m) => {
                const from = decodeHeader(m.payload?.headers, 'From');
                return extractEmailAddress(from)?.toLowerCase() === userEmailLower;
              });
              const isUnread = (data.messages ?? []).some((m) => m.labelIds?.includes('UNREAD'));

              return {
                gmailThreadId: threadId,
                gmailMessageId: message.id,
                subject: decodeHeader(headers, 'Subject'),
                fromAddress: decodeHeader(headers, 'From'),
                snippet: message.snippet ?? null,
                internalDate: message.internalDate
                  ? new Date(Number(message.internalDate))
                  : dateHeader
                    ? new Date(dateHeader)
                    : null,
                messageCount,
                hasReplyFromUser,
                isUnread,
              } satisfies FetchedThread;
            }),
          {
            retries: 3,
            factor: 2,
            minTimeout: 500,
            randomize: true,
            shouldRetry: ({ error }) => isRateLimitError(error),
          },
        ),
      ),
    ),
  );

  const threads: FetchedThread[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      threads.push(result.value);
    } else {
      failed.push(threadIds[i]!);
    }
  });

  return { threads, failed };
}
