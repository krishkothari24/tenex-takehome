import { boolean, jsonb, pgTable, real, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('emails_user_thread_unique').on(table.userId, table.gmailThreadId)],
);

// Scaffolded for Phase 2/3 — not populated or queried in Phase 1.
export const buckets = pgTable('buckets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Scaffolded for Phase 2 — not populated or queried in Phase 1.
export const classificationResults = pgTable('classification_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailId: uuid('email_id')
    .notNull()
    .references(() => emails.id, { onDelete: 'cascade' }),
  bucketId: uuid('bucket_id')
    .notNull()
    .references(() => buckets.id, { onDelete: 'cascade' }),
  confidence: real('confidence'),
  justification: text('justification'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
