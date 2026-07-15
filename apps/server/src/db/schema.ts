import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull(),
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  encryptedRefreshToken: text('encrypted_refresh_token'),
  tokenExpiry: timestamp('token_expiry', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emails = pgTable(
  'emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gmailThreadId: text('gmail_thread_id').notNull(),
    gmailMessageId: text('gmail_message_id').notNull(),
    subject: text('subject'),
    fromAddress: text('from_address'),
    snippet: text('snippet'),
    internalDate: timestamp('internal_date', { withTimezone: true }),
    rawHeaders: jsonb('raw_headers'),
    // Nullable — populated from data already fetched during sync (no extra Gmail API calls), but
    // null for any row synced before this column existed until the next sync re-populates it.
    // Powers the dashboard's "unanswered VIP" attention heuristic (build guide §6).
    messageCount: integer('message_count'),
    hasReplyFromUser: boolean('has_reply_from_user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('emails_user_thread_unique').on(table.userId, table.gmailThreadId)],
);

// Buckets are seeded per-user (defaults + custom), so userId is required —
// this keeps every user's classification taxonomy isolated. `description`
// grounds the LLM classifier; `color`/`sortOrder` drive the Phase 3 UI.
export const buckets = pgTable('buckets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One current classification per email (unique emailId → upsert; a full
// re-run against a new bucket set replaces it). `bucketId` is nullable so a
// batch that fails after its corrective retry can be persisted as a visible
// `status: 'unclassified'` row rather than being silently dropped.
export const classificationResults = pgTable(
  'classification_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emailId: uuid('email_id')
      .notNull()
      .references(() => emails.id, { onDelete: 'cascade' }),
    bucketId: uuid('bucket_id').references(() => buckets.id, { onDelete: 'cascade' }),
    secondaryBucketId: uuid('secondary_bucket_id').references(() => buckets.id, {
      onDelete: 'set null',
    }),
    confidence: real('confidence'),
    justification: text('justification'),
    // Model-estimated reading/response minutes for this specific email (build guide §6's
    // time-cost dashboard tile) — null exactly when status is 'unclassified'.
    estimatedReadMinutes: real('estimated_read_minutes'),
    // Deadline/urgency signal (build guide §6 stretch), extracted in the same batched call —
    // hasDeadline is null (not false) and deadlineText is null exactly when status is
    // 'unclassified', mirroring estimatedReadMinutes' nullability convention.
    hasDeadline: boolean('has_deadline'),
    deadlineText: text('deadline_text'),
    // True when the user manually moved this email to a bucket (via PATCH /api/emails/:id/bucket)
    // rather than the classifier — the reclassify pipeline skips these emails entirely (never
    // re-sent to Haiku), so a correction can't be silently clobbered by the next full re-run.
    isManualOverride: boolean('is_manual_override').notNull().default(false),
    status: text('status').notNull().default('classified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('classification_results_email_unique').on(table.emailId)],
);

// One row per generated digest (append-only, not upserted) — "regenerate" creates a new row so
// the cost/history of past runs is never lost; the API always reads the most recent by createdAt.
export const digests = pgTable('digests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  headline: text('headline').notNull(),
  actionItems: jsonb('action_items').notNull(),
  fyiCount: integer('fyi_count').notNull(),
  inputEmailCount: integer('input_email_count').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only audit trail of every manual (email, correctedBucket) pair — both what makes an
// override durable and, per build guide §5.7, exactly the feedback-loop data a production system
// would fold back into the eval set. `fromAddress` is denormalized (not a join through emails)
// because sender-rule suggestion groups by it directly and shouldn't need to touch `emails` again.
export const bucketCorrections = pgTable('bucket_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailId: uuid('email_id')
    .notNull()
    .references(() => emails.id, { onDelete: 'cascade' }),
  fromAddress: text('from_address'),
  fromBucketId: uuid('from_bucket_id').references(() => buckets.id, { onDelete: 'set null' }),
  toBucketId: uuid('to_bucket_id')
    .notNull()
    .references(() => buckets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A standing "always put mail from this sender in this bucket" rule, created by accepting a
// sender-rule suggestion. Applied before classification even runs (see stream-route.ts) — a
// ruled sender is assigned directly and never sent to Haiku, same cost/consistency reasoning as
// `isManualOverride`. One active rule per (user, sender).
export const senderRules = pgTable(
  'sender_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromAddress: text('from_address').notNull(),
    bucketId: uuid('bucket_id')
      .notNull()
      .references(() => buckets.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('sender_rules_user_address_unique').on(table.userId, table.fromAddress)],
);
