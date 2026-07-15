/**
 * The default bucket taxonomy (build guide §5.1). Kept small and clearly distinct so the
 * classifier's decision boundaries stay crisp. `description` is sent to the model verbatim
 * — it is the primary grounding for each label, so edit it as a prompt, not just a UI hint.
 * `color`/`sortOrder` are consumed by the Phase 3 bucket board.
 */
export interface DefaultBucketDef {
  name: string;
  description: string;
  color: string;
  sortOrder: number;
}

export const DEFAULT_BUCKETS: readonly DefaultBucketDef[] = [
  {
    name: 'Important',
    description:
      'Personal or work email that needs attention or a reply soon — from a real individual, asks a direct question, mentions a deadline, or requires the user to take an action.',
    color: '#F43F5E',
    sortOrder: 0,
  },
  {
    name: 'Can Wait',
    description:
      'Legitimate, relevant mail that is not time-sensitive — FYIs, receipts, confirmations, and updates the user may want to read later but does not need to act on now.',
    color: '#F59E0B',
    sortOrder: 1,
  },
  {
    name: 'Newsletter',
    description:
      'Subscribed bulk content the user opted into for regular reading — newsletters, digests, blog posts, and mailing-list threads.',
    color: '#6366F1',
    sortOrder: 2,
  },
  {
    name: 'Promotions',
    description:
      'Marketing and sales email from businesses — deals, discounts, product announcements, and promotional offers.',
    color: '#8B5CF6',
    sortOrder: 3,
  },
  {
    name: 'Auto-archive',
    description:
      'Low-value automated mail that needs no attention — no-reply system notifications, routine alerts, and machine-generated messages safe to archive unread.',
    color: '#64748B',
    sortOrder: 4,
  },
] as const;

export const DEFAULT_BUCKET_NAMES: readonly string[] = DEFAULT_BUCKETS.map((b) => b.name);
