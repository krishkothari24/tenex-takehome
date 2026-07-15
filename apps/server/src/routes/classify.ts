import type { FastifyInstance } from 'fastify';
import type { ClassifyStreamEvent } from '@inbox-concierge/shared';
import { listEmailsForClassification } from '../db/queries/emails.js';
import { seedDefaultBuckets } from '../db/queries/buckets.js';
import { markEmailsUnclassified, upsertClassification } from '../db/queries/classifications.js';
import {
  classifyEmails,
  CostCeilingExceededError,
  EmptyBucketSetError,
  MAX_EMAILS_PER_RUN,
  TooManyEmailsError,
} from '../services/classifier/index.js';
import type { BucketDef, ClassifierEmail } from '../services/classifier/index.js';

/**
 * `POST /api/classify` — streams an SSE `ClassifyStreamEvent` per completed batch.
 *
 * Deliberately not `EventSource`-based on the client: `EventSource` is GET-only, and this is a
 * mutating, side-effecting action (it persists classification_results rows), so the client
 * consumes this via `fetch()` + a manual `ReadableStream` reader instead.
 *
 * Always classifies the user's full synced inbox, not just unclassified emails — the same
 * full-re-run-over-incremental tradeoff the build guide calls out for custom-bucket
 * recategorization (§5.6): simpler, guarantees every email is judged against the same bucket
 * set, and `upsertClassification` is idempotent so re-classifying an already-classified email
 * just replaces its row rather than duplicating it.
 */
export default async function classifyRoutes(fastify: FastifyInstance) {
  fastify.post('/api/classify', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const userId = request.user.id;

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

    const send = (event: ClassifyStreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
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
        'Classification run completed',
      );
    } catch (err) {
      const { code, message } = describeClassifyError(err);
      request.log.error({ err, code }, 'Classification run failed');
      send({ type: 'error', code, message });
    } finally {
      reply.raw.end();
    }
  });
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
