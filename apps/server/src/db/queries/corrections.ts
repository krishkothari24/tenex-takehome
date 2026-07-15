import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { bucketCorrections } from '../schema.js';

export interface InsertCorrectionInput {
  userId: string;
  emailId: string;
  fromAddress: string | null;
  fromBucketId: string | null;
  toBucketId: string;
}

/** Append-only — the (email, correctedBucket) audit trail build guide §5.7 calls out as the seed
 *  of a production feedback loop, and the input to sender-rule suggestion. */
export async function insertCorrection(input: InsertCorrectionInput): Promise<void> {
  await db.insert(bucketCorrections).values(input);
}

export async function listCorrectionsForUser(userId: string) {
  return db
    .select({
      fromAddress: bucketCorrections.fromAddress,
      toBucketId: bucketCorrections.toBucketId,
    })
    .from(bucketCorrections)
    .where(eq(bucketCorrections.userId, userId));
}
