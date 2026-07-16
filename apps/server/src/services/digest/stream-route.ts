import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DigestStreamEvent } from '@inbox-concierge/shared';
import { listEmailsWithClassification } from '../../db/queries/classifications.js';
import { findUserById } from '../../db/queries/users.js';
import { insertDigest } from '../../db/queries/digests.js';
import { extractEmailAddress } from '../email-address.js';
import { computeVipSenders } from '../analytics/vip.js';
import { InsufficientCreditsError } from '../classifier/errors.js';
import { generateDigest, DigestCostCeilingExceededError, DigestGenerationError } from './index.js';
import type { DigestCandidateEmail } from './index.js';

export interface RunDigestStreamRouteParams {
  request: FastifyRequest;
  reply: FastifyReply;
  userId: string;
}

/**
 * SSE body for `POST /api/digest` — on-demand, never auto-fired on page load (the frontend gates
 * it behind an explicit "Generate this week's digest" button so a Sonnet call is never a surprise
 * cost). Builds the candidate shortlist from already-classified data (no new Gmail/LLM calls
 * beyond the one digest call itself), then persists the result so reopening the app is instant.
 */
export async function runDigestStreamRoute({ request, reply, userId }: RunDigestStreamRouteParams): Promise<void> {
  const [rows, user] = await Promise.all([listEmailsWithClassification(userId), findUserById(userId)]);

  const vipAddresses = new Set(
    computeVipSenders(
      rows.map((r) => ({ fromAddress: r.fromAddress, bucket: r.bucket, hasReplyFromUser: r.hasReplyFromUser })),
      user?.email ?? null,
    )
      .map((v) => v.emailAddress)
      .filter((address): address is string => address !== null),
  );

  const candidates: DigestCandidateEmail[] = rows
    .filter((r) => r.status === 'classified')
    .map((r) => {
      const address = extractEmailAddress(r.fromAddress);
      return {
        emailId: r.emailId,
        subject: r.subject,
        fromAddress: r.fromAddress,
        snippet: r.snippet,
        bucket: r.bucket,
        justification: r.justification,
        hasDeadline: r.hasDeadline,
        deadlineText: r.deadlineText,
        isUnansweredImportant: r.bucket === 'Important' && r.hasReplyFromUser === false,
        isVipSender: address !== null && vipAddresses.has(address),
      };
    });

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  request.raw.on('close', () => {
    request.log.debug('SSE client disconnected — digest run continues in the background');
  });

  const send = (event: DigestStreamEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      request.log.debug({ err }, 'SSE write failed (client likely disconnected)');
    }
  };

  const shortlist = candidates.filter(
    (c) => c.hasDeadline === true || c.isUnansweredImportant || c.isVipSender,
  );
  send({ type: 'started', inputEmailCount: shortlist.length });

  try {
    const result = await generateDigest(candidates);
    const row = await insertDigest({
      userId,
      headline: result.headline,
      actionItems: result.actionItems,
      fyiCount: result.fyiCount,
      inputEmailCount: result.inputEmailCount,
      costUsd: result.costUsd,
    });
    send({
      type: 'done',
      digest: {
        id: row.id,
        headline: row.headline,
        actionItems: result.actionItems,
        fyiCount: row.fyiCount,
        inputEmailCount: row.inputEmailCount,
        costUsd: row.costUsd,
        generatedAt: row.createdAt.toISOString(),
      },
    });
    request.log.info(
      { inputEmailCount: result.inputEmailCount, actionItems: result.actionItems.length, costUsd: result.costUsd },
      'Digest generation completed',
    );
  } catch (err) {
    const { code, message } = describeDigestError(err);
    request.log.error({ err, code }, 'Digest generation failed');
    send({ type: 'error', code, message });
  } finally {
    reply.raw.end();
  }
}

function describeDigestError(err: unknown): { code: string; message: string } {
  if (err instanceof DigestCostCeilingExceededError) return { code: 'COST_CEILING_EXCEEDED', message: err.message };
  if (err instanceof InsufficientCreditsError) return { code: 'INSUFFICIENT_CREDITS', message: err.message };
  if (err instanceof DigestGenerationError) return { code: 'DIGEST_FAILED', message: err.message };
  return {
    code: 'DIGEST_FAILED',
    message: err instanceof Error ? err.message : 'Digest generation failed unexpectedly.',
  };
}
