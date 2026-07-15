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
    status: text('status').notNull().default('classified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('classification_results_email_unique').on(table.emailId)],
);
