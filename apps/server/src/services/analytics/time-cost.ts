/**
 * Aggregates the classifier's per-email `estimatedReadMinutes` into the dashboard's time-cost
 * tile (build guide §6). Deliberately NOT a hardcoded per-bucket minutes table — the model already
 * estimates reading time per email as part of the same batched classify call, grounded in that
 * email's actual subject/snippet, so this module only sums/averages what it's given.
 */
export interface EmailReadEstimate {
  bucket: string;
  estimatedReadMinutes: number | null;
}

export interface TimeCostResult {
  byBucket: { bucket: string; emailCount: number; minutesPerEmail: number; totalMinutes: number }[];
  totalMinutes: number;
  totalHours: number;
  /** Unclassified or not-yet-(re)classified rows — excluded from the sum, not counted as zero. */
  unestimatedCount: number;
}

export function computeTimeCost(rows: EmailReadEstimate[]): TimeCostResult {
  const known = rows.filter(
    (r): r is EmailReadEstimate & { estimatedReadMinutes: number } => r.estimatedReadMinutes != null,
  );
  const totalMinutes = known.reduce((sum, r) => sum + r.estimatedReadMinutes, 0);

  const byBucketMap = new Map<string, { count: number; totalMinutes: number }>();
  for (const r of known) {
    const entry = byBucketMap.get(r.bucket) ?? { count: 0, totalMinutes: 0 };
    entry.count += 1;
    entry.totalMinutes += r.estimatedReadMinutes;
    byBucketMap.set(r.bucket, entry);
  }
  const byBucket = [...byBucketMap.entries()].map(([bucket, { count, totalMinutes: bucketMinutes }]) => ({
    bucket,
    emailCount: count,
    minutesPerEmail: bucketMinutes / count,
    totalMinutes: bucketMinutes,
  }));

  return {
    byBucket,
    totalMinutes,
    totalHours: totalMinutes / 60,
    unestimatedCount: rows.length - known.length,
  };
}
