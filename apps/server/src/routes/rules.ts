import type { FastifyInstance } from 'fastify';
import type { CreateRuleResponse, RuleSuggestionsResponse } from '@inbox-concierge/shared';
import { createRuleRequestSchema } from '@inbox-concierge/shared';
import { listCorrectionsForUser } from '../db/queries/corrections.js';
import { listSenderRulesForUser, upsertSenderRule } from '../db/queries/sender-rules.js';
import { findBucketForUser } from '../db/queries/buckets.js';
import { listEmailIdsFromSender } from '../db/queries/emails.js';
import { setManualBucket } from '../db/queries/classifications.js';
import { suggestSenderRules } from '../services/sender-rules.js';

export default async function rulesRoutes(fastify: FastifyInstance) {
  /** Computed live from the corrections audit trail — nothing persisted until accepted. */
  fastify.get('/api/rules/suggestions', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const userId = request.user.id;

    const [corrections, existingRules] = await Promise.all([
      listCorrectionsForUser(userId),
      listSenderRulesForUser(userId),
    ]);
    const bucketIds = new Set(existingRules.map((r) => r.fromAddress));
    const rawSuggestions = suggestSenderRules(corrections, bucketIds);

    const bucketNameCache = new Map<string, string | null>();
    const suggestions: RuleSuggestionsResponse['suggestions'] = [];
    for (const s of rawSuggestions) {
      if (!bucketNameCache.has(s.bucketId)) {
        const bucket = await findBucketForUser(s.bucketId, userId);
        bucketNameCache.set(s.bucketId, bucket?.name ?? null);
      }
      const bucketName = bucketNameCache.get(s.bucketId);
      if (bucketName) suggestions.push({ ...s, bucketName });
    }

    const response: RuleSuggestionsResponse = { suggestions };
    reply.send(response);
  });

  /**
   * Accepting a suggestion (or creating a rule directly) both persists the standing rule AND
   * applies it to every already-synced email from that sender immediately — a rule with zero
   * visible effect until the next reclassify would be a much weaker feature (see stream-route.ts
   * for how *future* emails from a ruled sender are handled without a second LLM call).
   */
  fastify.post('/api/rules', { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!request.user) return;
    const userId = request.user.id;

    const parsed = createRuleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'INVALID_RULE', message: 'A fromAddress and target bucketId are required.' });
      return;
    }

    const bucket = await findBucketForUser(parsed.data.bucketId, userId);
    if (!bucket) {
      reply.code(404).send({ error: 'BUCKET_NOT_FOUND', message: 'No such bucket.' });
      return;
    }

    const rule = await upsertSenderRule({ userId, fromAddress: parsed.data.fromAddress, bucketId: bucket.id });

    const matchingEmails = await listEmailIdsFromSender(userId, parsed.data.fromAddress);
    for (const email of matchingEmails) {
      await setManualBucket({ emailId: email.id, bucketId: bucket.id });
    }

    const response: CreateRuleResponse = {
      rule: {
        id: rule.id,
        fromAddress: parsed.data.fromAddress,
        bucketId: bucket.id,
        bucketName: bucket.name,
        appliedToCount: matchingEmails.length,
      },
    };
    reply.code(201).send(response);
  });
}
