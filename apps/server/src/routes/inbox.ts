import type { FastifyInstance } from 'fastify';
import type { InboxSyncResponse } from '@inbox-concierge/shared';
import { countEmails, listRecentEmails, upsertEmail } from '../db/queries/emails.js';
import { findUserById } from '../db/queries/users.js';
import { fetchRecentThreadsMetadata, GmailReauthRequiredError } from '../services/gmail-client.js';

export default async function inboxRoutes(fastify: FastifyInstance) {
  fastify.get('/api/inbox/sync', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;

    const user = await findUserById(request.user.id);
    if (!user) {
      return reply.code(401).send({ error: 'REAUTH_REQUIRED', message: 'Session user no longer exists.' });
    }

    const start = Date.now();
    try {
      const { threads, failed } = await fetchRecentThreadsMetadata(user);

      for (const thread of threads) {
        await upsertEmail({
          userId: user.id,
          gmailThreadId: thread.gmailThreadId,
          gmailMessageId: thread.gmailMessageId,
          subject: thread.subject,
          fromAddress: thread.fromAddress,
          snippet: thread.snippet,
          internalDate: thread.internalDate,
          messageCount: thread.messageCount,
          hasReplyFromUser: thread.hasReplyFromUser,
          isUnread: thread.isUnread,
        });
      }

      const totalCount = await countEmails(user.id);
      const sample = await listRecentEmails(user.id, 20);

      request.log.info(
        { fetched: threads.length, failed: failed.length, totalCount, durationMs: Date.now() - start },
        'Inbox sync completed',
      );

      const response: InboxSyncResponse = {
        count: totalCount,
        sample: sample.map((row) => ({
          id: row.id,
          gmailThreadId: row.gmailThreadId,
          subject: row.subject,
          fromAddress: row.fromAddress,
          snippet: row.snippet,
          internalDate: row.internalDate ? row.internalDate.toISOString() : null,
        })),
        failed,
      };
      reply.send(response);
    } catch (err) {
      if (err instanceof GmailReauthRequiredError) {
        return reply.code(401).send({ error: 'REAUTH_REQUIRED', message: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, `Inbox sync failed: ${message}`);
      reply.code(502).send({ error: 'GMAIL_SYNC_FAILED', message: 'Could not reach Gmail — please try again.' });
    }
  });
}
