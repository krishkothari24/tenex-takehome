import type { DashboardAnalytics } from '@inbox-concierge/shared';
import { listBuckets } from '../../db/queries/buckets.js';
import { listEmailsWithClassification } from '../../db/queries/classifications.js';
import { findUserById } from '../../db/queries/users.js';
import { extractDisplayName, extractEmailAddress } from '../email-address.js';
import { computeVipSenders } from './vip.js';

const UNSORTED_LABEL = 'Unsorted';
const TOP_SENDER_LIMIT = 10;

/**
 * Builds the dashboard's tiles (build guide §6) from one join query. Pure DB reads, no
 * external API calls — no rate limits/retries/cost ceiling needed here, unlike the classifier
 * path; the only realistic failure is a DB outage, which the route surfaces as a plain 500.
 */
export async function computeDashboardAnalytics(userId: string): Promise<DashboardAnalytics> {
  const [rows, buckets, user] = await Promise.all([
    listEmailsWithClassification(userId),
    listBuckets(userId),
    findUserById(userId),
  ]);
  const colorByBucketName = new Map(buckets.map((b) => [b.name, b.color]));

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

  const vipSenders = computeVipSenders(
    rows.map((r) => ({ fromAddress: r.fromAddress, bucket: r.bucket, hasReplyFromUser: r.hasReplyFromUser })),
    user?.email ?? null,
  );

  return {
    totalEmails: rows.length,
    attention,
    volumeByBucket,
    topSenders,
    vipSenders,
  };
}
