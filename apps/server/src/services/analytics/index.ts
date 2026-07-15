import type { DashboardAnalytics } from '@inbox-concierge/shared';
import { listBuckets } from '../../db/queries/buckets.js';
import { listEmailsWithClassification } from '../../db/queries/classifications.js';
import { extractDisplayName, extractEmailAddress } from '../email-address.js';
import { computeTimeCost } from './time-cost.js';

const UNSORTED_LABEL = 'Unsorted';
const TOP_SENDER_LIMIT = 10;

const TIME_COST_ASSUMPTION_NOTE =
  "Each email's reading/response time is estimated by the classifier from its actual subject and " +
  "content when it's sorted — not a fixed per-bucket average. Still an estimate, not a measurement.";

/**
 * Builds the dashboard's four tiles (build guide §6) from one join query. Pure DB reads, no
 * external API calls — no rate limits/retries/cost ceiling needed here, unlike the classifier
 * path; the only realistic failure is a DB outage, which the route surfaces as a plain 500.
 */
export async function computeDashboardAnalytics(userId: string): Promise<DashboardAnalytics> {
  const [rows, buckets] = await Promise.all([listEmailsWithClassification(userId), listBuckets(userId)]);
  const colorByBucketName = new Map(buckets.map((b) => [b.name, b.color]));

  const timeCost = computeTimeCost(
    rows.map((r) => ({ bucket: r.bucket ?? UNSORTED_LABEL, estimatedReadMinutes: r.estimatedReadMinutes })),
  );

  // The "from a real person" half of the build guide's attention heuristic is delegated to the
  // classifier — DEFAULT_BUCKETS['Important'].description already grounds that judgment. This only
  // computes the "no sent reply in thread" half, which needs the stored Gmail reply data.
  const importantRows = rows.filter((r) => r.bucket === 'Important');
  const attention = {
    importantTotal: importantRows.length,
    unansweredCount: importantRows.filter((r) => r.hasReplyFromUser === false).length,
    unknownReplyStatusCount: importantRows.filter((r) => r.hasReplyFromUser === null).length,
  };

  const volumeCounts = new Map<string, number>();
  for (const r of rows) {
    const label = r.bucket ?? UNSORTED_LABEL;
    volumeCounts.set(label, (volumeCounts.get(label) ?? 0) + 1);
  }
  const volumeByBucket = [...volumeCounts.entries()].map(([bucket, count]) => ({
    bucket,
    color: colorByBucketName.get(bucket) ?? null,
    count,
  }));

  // Group by the parsed bare address (not the raw header) so two "From" headers with the same
  // address but different display-name casing count as one sender.
  const senderCounts = new Map<string, { label: string; address: string | null; count: number }>();
  for (const r of rows) {
    const address = extractEmailAddress(r.fromAddress);
    const key = address ?? r.fromAddress ?? '(unknown sender)';
    const existing = senderCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      senderCounts.set(key, {
        label: extractDisplayName(r.fromAddress) ?? address ?? r.fromAddress ?? '(unknown sender)',
        address,
        count: 1,
      });
    }
  }
  const topSenders = [...senderCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_SENDER_LIMIT)
    .map((s) => ({ senderLabel: s.label, emailAddress: s.address, count: s.count }));

  return {
    totalEmails: rows.length,
    timeCost: {
      byBucket: timeCost.byBucket,
      totalMinutes: timeCost.totalMinutes,
      totalHours: timeCost.totalHours,
      unestimatedCount: timeCost.unestimatedCount,
      assumptionNote: TIME_COST_ASSUMPTION_NOTE,
    },
    attention,
    volumeByBucket,
    topSenders,
  };
}
