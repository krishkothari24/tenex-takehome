import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ClassifyStreamEvent, EmailClassification } from '@inbox-concierge/shared';
import { listEmailsForClassification } from '../../db/queries/emails.js';
import { seedDefaultBuckets } from '../../db/queries/buckets.js';
import { markEmailsUnclassified, setManualBucket, upsertClassification } from '../../db/queries/classifications.js';
import { listSenderRulesForUser } from '../../db/queries/sender-rules.js';
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
  const idToName = new Map(bucketRows.map((b) => [b.id, b.name]));
  const buckets: BucketDef[] = bucketRows.map((b) => ({ name: b.name, description: b.description }));

  const allEmails = await listEmailsForClassification(userId);
  const rules = await listSenderRulesForUser(userId);
  const ruleBucketByAddress = new Map(rules.map((r) => [r.fromAddress, r.bucketId]));

  // Manually-corrected emails are never re-sent to Haiku — their bucket is a human decision, not
  // the model's to revise on the next full re-run (see classifications.ts's `setManualBucket`
  // doc comment). Sender-ruled emails are assigned directly and deterministically, at zero API
  // cost, before the LLM batch even runs. Both skip the model entirely, not just get protected
  // after the fact.
  const overridden = allEmails.filter((e) => e.isManualOverride === true);
  const ruled = allEmails.filter(
    (e) => e.isManualOverride !== true && e.fromAddress !== null && ruleBucketByAddress.has(e.fromAddress),
  );
  const remaining = allEmails.filter(
    (e) => e.isManualOverride !== true && !(e.fromAddress !== null && ruleBucketByAddress.has(e.fromAddress)),
  );
  void overridden; // intentionally untouched — no DB write, no SSE event, board already shows them correctly

  // The per-run cap bounds LLM volume/cost (§5.8), so it applies to the emails actually sent to
  // Haiku — overridden/ruled emails cost nothing and were already excluded above.
  const emails: ClassifierEmail[] = remaining
    .slice(0, MAX_EMAILS_PER_RUN)
    .map((e) => ({ id: e.id, subject: e.subject, fromAddress: e.fromAddress, snippet: e.snippet }));

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
              hasDeadline: c.hasDeadline,
              deadlineText: c.deadlineText,
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

    // Sender-ruled emails, applied after the real batches so this reads as "one more batch" in
    // the frontend's progress indicator rather than a batchCount that looks inconsistent partway
    // through the real run. No LLM call — deterministic, grounded in the rule the user accepted.
    const ruledClassifications: EmailClassification[] = [];
    for (const e of ruled) {
      const bucketId = ruleBucketByAddress.get(e.fromAddress!)!;
      const bucketName = idToName.get(bucketId) ?? null;
      await setManualBucket({ emailId: e.id, bucketId });
      ruledClassifications.push({
        emailId: e.id,
        bucket: bucketName,
        secondaryBucket: null,
        confidence: null,
        justification: bucketName
          ? `Matches your rule: mail from ${e.fromAddress} always goes to ${bucketName}.`
          : null,
        isAmbiguous: false,
        status: 'classified',
        estimatedReadMinutes: e.estimatedReadMinutes,
        hasDeadline: e.hasDeadline,
        deadlineText: e.deadlineText,
      });
    }
    if (ruledClassifications.length > 0) {
      batchCount += 1;
      send({
        type: 'batch',
        batchIndex: batchCount - 1,
        batchCount,
        status: 'ok',
        classifications: ruledClassifications,
        unclassifiedEmailIds: [],
      });
    }

    send({
      type: 'done',
      totalClassified: result.classifications.length + ruledClassifications.length,
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
        overriddenCount: overridden.length,
        ruledCount: ruled.length,
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
