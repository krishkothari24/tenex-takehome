import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { senderRules } from '../schema.js';

export interface UpsertSenderRuleInput {
  userId: string;
  fromAddress: string;
  bucketId: string;
}

export async function listSenderRulesForUser(userId: string) {
  return db
    .select({ id: senderRules.id, fromAddress: senderRules.fromAddress, bucketId: senderRules.bucketId })
    .from(senderRules)
    .where(eq(senderRules.userId, userId));
}

/** One active rule per (user, sender) — accepting a new suggestion for an already-ruled sender
 *  replaces the target bucket rather than creating a duplicate. */
export async function upsertSenderRule(input: UpsertSenderRuleInput) {
  const [row] = await db
    .insert(senderRules)
    .values(input)
    .onConflictDoUpdate({
      target: [senderRules.userId, senderRules.fromAddress],
      set: { bucketId: input.bucketId },
    })
    .returning();
  if (!row) throw new Error('upsertSenderRule: insert returned no row');
  return row;
}
