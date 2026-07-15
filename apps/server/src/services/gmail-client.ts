import { gmail_v1, google } from 'googleapis';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { updateUserTokens, markUserRevoked } from '../db/queries/users.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { createOAuthClient } from './google-oauth.js';

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
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiry: Date;
}

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: number | string; response?: { status?: number } })?.code;
  const status = (err as { response?: { status?: number } })?.response?.status;
  return code === 401 || status === 401 || code === 'invalid_grant';
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
