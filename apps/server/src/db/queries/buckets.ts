import { and, asc, eq } from 'drizzle-orm';
import type { Bucket } from '@inbox-concierge/shared';
import { db } from '../client.js';
import { buckets } from '../schema.js';
import { DEFAULT_BUCKETS } from '../../services/default-buckets.js';

type BucketRow = typeof buckets.$inferSelect;

function toBucket(row: BucketRow): Bucket {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
  };
}

export async function listBuckets(userId: string): Promise<Bucket[]> {
  const rows = await db
    .select()
    .from(buckets)
    .where(eq(buckets.userId, userId))
    .orderBy(asc(buckets.sortOrder), asc(buckets.createdAt));
  return rows.map(toBucket);
}

/** Idempotent — seeds the default taxonomy for a user only if they have no buckets yet. */
export async function seedDefaultBuckets(userId: string): Promise<Bucket[]> {
  const existing = await db.select({ id: buckets.id }).from(buckets).where(eq(buckets.userId, userId));
  if (existing.length === 0) {
    await db.insert(buckets).values(
      DEFAULT_BUCKETS.map((b) => ({
        userId,
        name: b.name,
        description: b.description,
        color: b.color,
        sortOrder: b.sortOrder,
        isDefault: true,
      })),
    );
  }
  return listBuckets(userId);
}

export async function createBucket(
  userId: string,
  input: { name: string; description?: string | null; color?: string | null },
): Promise<Bucket> {
  const existing = await listBuckets(userId);
  const sortOrder = existing.reduce((max, b) => Math.max(max, b.sortOrder), -1) + 1;
  const [row] = await db
    .insert(buckets)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      sortOrder,
      isDefault: false,
    })
    .returning();
  return toBucket(row!);
}

/** Only removes a user's own custom bucket. Default buckets are protected from deletion. */
export async function deleteBucket(id: string, userId: string): Promise<void> {
  await db
    .delete(buckets)
    .where(and(eq(buckets.id, id), eq(buckets.userId, userId), eq(buckets.isDefault, false)));
}
