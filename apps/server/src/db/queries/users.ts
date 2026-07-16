import { desc, eq } from 'drizzle-orm';
import { db } from '../client.js';
import { users } from '../schema.js';

export interface UpsertUserInput {
  googleId: string;
  email: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiry: Date;
}

/**
 * Refresh tokens are only reissued by Google on first consent (or a forced
 * `prompt=consent`). A plain upsert would null out an existing refresh token
 * on every subsequent login, so we only overwrite it when a new one arrives.
 */
export async function upsertUser(input: UpsertUserInput) {
  const [row] = await db
    .insert(users)
    .values({
      googleId: input.googleId,
      email: input.email,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      tokenExpiry: input.tokenExpiry,
      revokedAt: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.googleId,
      set: {
        email: input.email,
        encryptedAccessToken: input.encryptedAccessToken,
        ...(input.encryptedRefreshToken
          ? { encryptedRefreshToken: input.encryptedRefreshToken }
          : {}),
        tokenExpiry: input.tokenExpiry,
        revokedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function findUserById(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function findUserByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

/** For dev tooling (the classify:dev script) — pick a user to operate on. */
export async function listUsers() {
  return db.select({ id: users.id, email: users.email }).from(users).orderBy(desc(users.createdAt));
}

export async function updateUserTokens(
  id: string,
  tokens: { encryptedAccessToken: string; encryptedRefreshToken?: string | null; tokenExpiry: Date },
) {
  await db
    .update(users)
    .set({
      encryptedAccessToken: tokens.encryptedAccessToken,
      ...(tokens.encryptedRefreshToken !== undefined
        ? { encryptedRefreshToken: tokens.encryptedRefreshToken }
        : {}),
      tokenExpiry: tokens.tokenExpiry,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}

export async function markUserRevoked(id: string) {
  await db.update(users).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, id));
}

/** "Delete my data" — every FK to users.id (emails, buckets, digests, ...) cascades, so this is
 *  the one query that needs to run. */
export async function deleteUser(id: string) {
  await db.delete(users).where(eq(users.id, id));
}
