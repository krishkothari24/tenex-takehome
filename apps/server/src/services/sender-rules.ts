const DEFAULT_THRESHOLD = 3;

export interface CorrectionRow {
  fromAddress: string | null;
  toBucketId: string;
}

export interface SenderRuleSuggestion {
  fromAddress: string;
  bucketId: string;
  correctionCount: number;
}

/**
 * Turns repeated manual corrections into a standing-rule suggestion (build guide §5.7's
 * feedback-loop framing) — pure and DB-free, mirroring `custom-bucket.ts`'s shape. A sender
 * crosses the threshold once `threshold` corrections for them all point at the same bucket;
 * `alreadyRuledAddresses` excludes senders who already have an active rule, so an accepted
 * suggestion doesn't keep re-suggesting itself. Sorted by count so the strongest signal surfaces
 * first if the caller only wants to show one.
 */
export function suggestSenderRules(
  corrections: CorrectionRow[],
  alreadyRuledAddresses: ReadonlySet<string>,
  threshold: number = DEFAULT_THRESHOLD,
): SenderRuleSuggestion[] {
  const countsByAddress = new Map<string, Map<string, number>>();
  for (const { fromAddress, toBucketId } of corrections) {
    if (!fromAddress || alreadyRuledAddresses.has(fromAddress)) continue;
    const byBucket = countsByAddress.get(fromAddress) ?? new Map<string, number>();
    byBucket.set(toBucketId, (byBucket.get(toBucketId) ?? 0) + 1);
    countsByAddress.set(fromAddress, byBucket);
  }

  const suggestions: SenderRuleSuggestion[] = [];
  for (const [fromAddress, byBucket] of countsByAddress) {
    for (const [bucketId, correctionCount] of byBucket) {
      if (correctionCount >= threshold) suggestions.push({ fromAddress, bucketId, correctionCount });
    }
  }
  return suggestions.sort((a, b) => b.correctionCount - a.correctionCount);
}
