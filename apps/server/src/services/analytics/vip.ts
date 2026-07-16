import { extractDisplayName, extractEmailAddress } from '../email-address.js';

/**
 * Relationship-strength ranking (build guide §6 stretch: "VIP/relationship scoring inferred from
 * reply-frequency history") — deterministic, no LLM call. Scoped honestly to the current sync
 * snapshot (the last ~200 threads), the same scope the Attention and Sender-Frequency tiles
 * already use — this does not claim a cross-sync relationship history the app doesn't store.
 */
export interface SenderActivityRow {
  fromAddress: string | null;
  bucket: string | null;
  hasReplyFromUser: boolean | null;
}

export interface VipSender {
  senderLabel: string;
  emailAddress: string | null;
  threadCount: number;
  importantCount: number;
  /** Fraction of this sender's threads with a known reply, excluding unknown-reply-status threads
   *  from the denominator (same honesty convention as the attention tile's unknownReplyStatusCount). */
  replyRate: number;
  score: number;
}

// A single thread isn't a relationship pattern — require at least this many in the snapshot.
const MIN_THREADS = 2;
const VIP_LIMIT = 5;

/**
 * Frequency is the primary signal (you don't have a relationship with someone who's emailed you
 * once); reply-rate and importance-rate are secondary nudges bounded to a [0.6, 1.0] multiplier so
 * they re-rank among frequent senders rather than letting a single high-importance thread outrank
 * genuine frequency.
 */
export function computeVipSenders(rows: SenderActivityRow[], ownEmail: string | null): VipSender[] {
  const bySender = new Map<
    string,
    { label: string; address: string | null; threadCount: number; repliedCount: number; unknownReplyCount: number; importantCount: number }
  >();

  for (const row of rows) {
    const address = extractEmailAddress(row.fromAddress);
    if (ownEmail && address && address.toLowerCase() === ownEmail.toLowerCase()) continue;
    const key = address ?? row.fromAddress ?? '(unknown sender)';
    const existing = bySender.get(key);
    const entry = existing ?? {
      label: extractDisplayName(row.fromAddress) ?? address ?? row.fromAddress ?? '(unknown sender)',
      address,
      threadCount: 0,
      repliedCount: 0,
      unknownReplyCount: 0,
      importantCount: 0,
    };
    entry.threadCount += 1;
    if (row.hasReplyFromUser === true) entry.repliedCount += 1;
    if (row.hasReplyFromUser === null) entry.unknownReplyCount += 1;
    if (row.bucket === 'Important') entry.importantCount += 1;
    bySender.set(key, entry);
  }

  const scored: VipSender[] = [];
  for (const entry of bySender.values()) {
    if (entry.threadCount < MIN_THREADS) continue;
    const knownReplyThreads = entry.threadCount - entry.unknownReplyCount;
    const replyRate = knownReplyThreads > 0 ? entry.repliedCount / knownReplyThreads : 0;
    const importanceRate = entry.importantCount / entry.threadCount;
    const score = entry.threadCount * (0.6 + 0.2 * replyRate + 0.2 * importanceRate);
    scored.push({
      senderLabel: entry.label,
      emailAddress: entry.address,
      threadCount: entry.threadCount,
      importantCount: entry.importantCount,
      replyRate,
      score,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, VIP_LIMIT);
}
