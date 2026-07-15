import { desc, eq } from 'drizzle-orm';
import { db } from '../client.js';
import { digests } from '../schema.js';

export interface InsertDigestInput {
  userId: string;
  headline: string;
  actionItems: unknown;
  fyiCount: number;
  inputEmailCount: number;
  costUsd: number;
}

export async function insertDigest(input: InsertDigestInput) {
  const [row] = await db.insert(digests).values(input).returning();
  if (!row) throw new Error('insertDigest: insert returned no row');
  return row;
}

/** Most recent digest for a user, or null if none has been generated yet. */
export async function getLatestDigest(userId: string) {
  const [row] = await db
    .select()
    .from(digests)
    .where(eq(digests.userId, userId))
    .orderBy(desc(digests.createdAt))
    .limit(1);
  return row ?? null;
}
