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

/**
 * Idempotent — seeds the full default taxonomy for a user only if they have no buckets yet.
 * No longer called from any live route: `GET /api/buckets` and the classify/reclassify stream
 * route both use a plain `listBuckets` now, so a brand-new user sees an explicit opt-in picker
 * (`POST /api/buckets/defaults` via `createDefaultBuckets` below) instead of these silently
 * materializing. Kept only for `scripts/classify-dev.ts`, a local CLI tool with no picker UI to
 * go through.
 */
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

/** Bulk-inserts the caller's selected subset of the canonical DEFAULT_BUCKETS (matched by name),
 *  each with its canonical description/color and isDefault: true, appended after the user's
 *  current max sortOrder. Used by the opt-in bucket picker — unlike `seedDefaultBuckets`, this is
 *  not all-or-nothing and can be called for any non-empty subset. */
export async function createDefaultBuckets(userId: string, names: string[]): Promise<Bucket[]> {
  const existing = await listBuckets(userId);
  let nextSortOrder = existing.reduce((max, b) => Math.max(max, b.sortOrder), -1) + 1;
  const defs = DEFAULT_BUCKETS.filter((d) => names.includes(d.name));
  if (defs.length > 0) {
    await db.insert(buckets).values(
      defs.map((d) => ({
        userId,
        name: d.name,
        description: d.description,
        color: d.color,
        sortOrder: nextSortOrder++,
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

/** Ownership check for a target bucket — used by manual move and sender-rule creation so a
 *  client-supplied bucketId can never point at another user's bucket. */
export async function findBucketForUser(id: string, userId: string): Promise<Bucket | null> {
  const [row] = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.id, id), eq(buckets.userId, userId)))
    .limit(1);
  return row ? toBucket(row) : null;
}

/** Only removes a user's own custom bucket. Default buckets are protected from deletion. */
export async function deleteBucket(id: string, userId: string): Promise<void> {
  await db
    .delete(buckets)
    .where(and(eq(buckets.id, id), eq(buckets.userId, userId), eq(buckets.isDefault, false)));
}

/** Rewrites sortOrder to match `orderedIds`' array index, scoped by userId per row. A handful of
 *  small per-row updates in one transaction — this only ever touches one user's bucket count (a
 *  few rows) and fires on a manual drag, not a hot path, so a bulk `CASE WHEN` isn't worth the
 *  raw-SQL complexity. The transaction is what matters: it keeps a page refresh mid-drag from
 *  ever landing a partially reordered set. */
export async function reorderBuckets(userId: string, orderedIds: string[]): Promise<Bucket[]> {
  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.update(buckets).set({ sortOrder: index }).where(and(eq(buckets.id, id), eq(buckets.userId, userId)));
    }
  });
  return listBuckets(userId);
}
