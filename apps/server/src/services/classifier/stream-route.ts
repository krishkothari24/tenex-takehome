import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ClassifyStreamEvent } from '@inbox-concierge/shared';
import { listEmailsForClassification } from '../../db/queries/emails.js';
import { seedDefaultBuckets } from '../../db/queries/buckets.js';
import { markEmailsUnclassified, upsertClassification } from '../../db/queries/classifications.js';
import {
  classifyEmails,
  CostCeilingExceededError,
  EmptyBucketSetError,
  MAX_EMAILS_PER_RUN,
  TooManyEmailsError,
} from './index.js';
import type { BucketDef, ClassifierEmail } from './index.js';

export interface RunClassifyStreamRouteParams {
  request: FastifyRequest;
  reply: FastifyReply;
  userId: string;
  /** Only used for log labeling — `/api/classify` and `/api/reclassify` are the same pipeline
   *  run against whatever the user's current full bucket set happens to be (see each route's own
   *  doc comment for why they're still separate routes). */
  runLabel: 'Classification' | 'Reclassification';
}

/**
 * Shared SSE-streaming body for `POST /api/classify` and `POST /api/reclassify` — extracted so
 * both routes share one hijack/writeHead/send/pipeline implementation instead of duplicating it.
 *
 * Always classifies the user's full synced inbox against their full current bucket set (not just
 * unclassified emails) — the same full-re-run-over-incremental tradeoff the build guide calls out
 * for custom-bucket recategorization (§5.6): simpler, guarantees every email is judged against the
 * same bucket set, and `upsertClassification` is idempotent so re-classifying an already-classified
 * email just replaces its row rather than duplicating it.
 */
export async function runClassifyStreamRoute({
  request,
  reply,
  userId,
  runLabel,
}: RunClassifyStreamRouteParams): Promise<void> {
  const bucketRows = await seedDefaultBuckets(userId);
  const nameToId = new Map(bucketRows.map((b) => [b.name, b.id]));
  const buckets: BucketDef[] = bucketRows.map((b) => ({ name: b.name, description: b.description }));

  const allEmails = await listEmailsForClassification(userId);
  const emails: ClassifierEmail[] = allEmails.slice(0, MAX_EMAILS_PER_RUN);

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Observability only — logs a disconnect, does not cancel the in-flight pipeline. Cancelling
  // already-dispatched Anthropic calls mid-run is a deliberately out-of-scope, low-value change
  // for the risk this late in the build; persistence to Postgres should still happen regardless
  // of whether anyone is listening (matches the "reopen is instant" architecture).
  request.raw.on('close', () => {
    request.log.debug({ runLabel }, 'SSE client disconnected — pipeline continues in the background');
  });

  const send = (event: ClassifyStreamEvent) => {
    // A write after the client has disconnected can fail (closed socket) — swallow it so a
    // disconnect is never miscategorized as a batch/run failure by the caller's try/catch.
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      request.log.debug({ err, runLabel }, 'SSE write failed (client likely disconnected)');
    }
  };

  let batchCount = 0;

  try {
    const result = await classifyEmails(emails, buckets, {
      onEstimate: (estimate, count) => {
        batchCount = count;
        send({ type: 'estimate', estimate, batchCount: count });
      },
      onBatchComplete: async (outcome) => {
        if (outcome.status === 'ok') {
          for (const c of outcome.classifications) {
            const bucketId = c.bucket ? (nameToId.get(c.bucket) ?? null) : null;
            await upsertClassification({
              emailId: c.emailId,
              bucketId,
              secondaryBucketId: c.secondaryBucket ? (nameToId.get(c.secondaryBucket) ?? null) : null,
              confidence: c.confidence,
              justification: c.justification,
              status: bucketId ? 'classified' : 'unclassified',
              estimatedReadMinutes: c.estimatedReadMinutes,
            });
          }
        } else {
          await markEmailsUnclassified(outcome.unclassifiedEmailIds);
        }
        send({
          type: 'batch',
          batchIndex: outcome.batchIndex,
          batchCount,
          status: outcome.status,
          classifications: outcome.classifications,
          unclassifiedEmailIds: outcome.unclassifiedEmailIds,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        });
      },
    });

    send({
      type: 'done',
      totalClassified: result.classifications.length,
      totalUnclassified: result.unclassifiedEmailIds.length,
      actualCostUsd: result.actualCostUsd,
      durationMs: result.durationMs,
      dryRun: result.dryRun,
    });
    request.log.info(
      {
        batchCount: result.batchCount,
        totalClassified: result.classifications.length,
        totalUnclassified: result.unclassifiedEmailIds.length,
        actualCostUsd: result.actualCostUsd,
        durationMs: result.durationMs,
      },
      `${runLabel} run completed`,
    );
  } catch (err) {
    const { code, message } = describeClassifyError(err);
    request.log.error({ err, code }, `${runLabel} run failed`);
    send({ type: 'error', code, message });
  } finally {
    reply.raw.end();
  }
}

function describeClassifyError(err: unknown): { code: string; message: string } {
  if (err instanceof EmptyBucketSetError) return { code: 'EMPTY_BUCKET_SET', message: err.message };
  if (err instanceof TooManyEmailsError) return { code: 'TOO_MANY_EMAILS', message: err.message };
  if (err instanceof CostCeilingExceededError) return { code: 'COST_CEILING_EXCEEDED', message: err.message };
  return {
    code: 'CLASSIFY_FAILED',
    message: err instanceof Error ? err.message : 'Classification failed unexpectedly.',
  };
}
