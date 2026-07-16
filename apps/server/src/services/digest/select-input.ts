import { MAX_DIGEST_INPUT_EMAILS } from './config.js';

/**
 * A classified email plus the two deterministic signals (§6 stretch) that make it a digest
 * candidate. `isUnansweredImportant` and `isVipSender` are computed by the caller from data this
 * module doesn't own (bucket names, VIP sender addresses) — kept decoupled so this stays a pure,
 * easily-testable selection function.
 */
export interface DigestCandidateEmail {
  emailId: string;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  bucket: string | null;
  justification: string | null;
  hasDeadline: boolean | null;
  deadlineText: string | null;
  isUnansweredImportant: boolean;
  isVipSender: boolean;
}

/**
 * Selects the salient subset of a classified inbox to feed one digest call: unanswered Important
 * threads, emails with a stated deadline, and messages from frequent/high-engagement senders.
 * Ranked by how many signals overlap (deadline + unanswered-important weigh more than a VIP sender
 * alone) and capped so the digest stays a digest and the Sonnet call stays small.
 */
export function selectDigestInput(candidates: DigestCandidateEmail[]): DigestCandidateEmail[] {
  return candidates
    .filter((c) => c.hasDeadline === true || c.isUnansweredImportant || c.isVipSender)
    .map((c) => ({
      candidate: c,
      score: (c.hasDeadline ? 3 : 0) + (c.isUnansweredImportant ? 3 : 0) + (c.isVipSender ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DIGEST_INPUT_EMAILS)
    .map((s) => s.candidate);
}
