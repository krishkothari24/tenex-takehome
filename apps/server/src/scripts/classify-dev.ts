/**
 * Phase 2 proof script (build guide §9: "prove it works with a script before wiring the UI").
 * Classifies a user's already-synced inbox end to end, persists results as each batch streams in,
 * and prints a summary — bucket counts, sample justifications, cost/token/timing, and any failures.
 *
 * Cost-safe by default: prints the estimate and makes NO API calls unless you pass `--confirm`.
 *   npm run classify:dev                       # dry run — estimate only, $0 spent
 *   npm run classify:dev -- --confirm          # classify the first user's inbox (~$0.08 for 200)
 *   npm run classify:dev -- --confirm --email you@example.com   # pick a user explicitly
 */
import { pool } from '../db/client.js';
import { listEmailsForClassification } from '../db/queries/emails.js';
import { seedDefaultBuckets } from '../db/queries/buckets.js';
import {
  listClassificationsForUser,
  markEmailsUnclassified,
  upsertClassification,
} from '../db/queries/classifications.js';
import { findUserByEmail, listUsers } from '../db/queries/users.js';
import {
  classifyEmails,
  estimateRun,
  isDryRun,
  MAX_EMAILS_PER_RUN,
} from '../services/classifier/index.js';
import type { BucketDef, ClassifierEmail } from '../services/classifier/index.js';

const fmtUsd = (n: number) => `$${n.toFixed(4)}`;

function parseArgs() {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf('--email');
  return {
    confirm: args.includes('--confirm'),
    email: emailIdx >= 0 ? args[emailIdx + 1] : undefined,
  };
}

async function main() {
  const { confirm, email } = parseArgs();

  const user = email ? await findUserByEmail(email) : (await listUsers())[0];
  if (!user) {
    console.error(
      email
        ? `No user found with email ${email}.`
        : 'No users in the database — sign in via Google OAuth and sync the inbox first.',
    );
    process.exitCode = 1;
    return;
  }

  const bucketRows = await seedDefaultBuckets(user.id);
  const nameToId = new Map(bucketRows.map((b) => [b.name, b.id]));
  const buckets: BucketDef[] = bucketRows.map((b) => ({ name: b.name, description: b.description }));

  const allEmails = await listEmailsForClassification(user.id);
  const emails: ClassifierEmail[] = allEmails.slice(0, MAX_EMAILS_PER_RUN);

  console.log(`\nUser: ${user.email}`);
  console.log(`Buckets: ${bucketRows.map((b) => b.name).join(', ')}`);
  console.log(`Emails to classify: ${emails.length}${allEmails.length > emails.length ? ` (capped from ${allEmails.length})` : ''}`);

  if (emails.length === 0) {
    console.log('\nNothing to classify — sync the inbox first (GET /api/inbox/sync).\n');
    return;
  }

  const { estimate, batchCount } = estimateRun(emails, buckets);
  console.log(
    `Worst-case cost estimate: ${fmtUsd(estimate.estimatedCostUsd)} across ${batchCount} batch(es).`,
  );

  if (!confirm) {
    console.log('\nDry run — no API calls made. Re-run with `--confirm` to classify.\n');
    return;
  }
  if (isDryRun()) {
    console.log('\nCLASSIFIER_DRY_RUN is set — no API calls will be made; results will be unclassified.');
  }

  console.log('\nClassifying (results persist as each batch completes):');
  const result = await classifyEmails(emails, buckets, {
    onBatchComplete: async (outcome) => {
      if (outcome.status === 'ok') {
        for (const c of outcome.classifications) {
          const bucketId = c.bucket ? nameToId.get(c.bucket) ?? null : null;
          await upsertClassification({
            emailId: c.emailId,
            bucketId,
            secondaryBucketId: c.secondaryBucket ? nameToId.get(c.secondaryBucket) ?? null : null,
            confidence: c.confidence,
            justification: c.justification,
            status: bucketId ? 'classified' : 'unclassified',
            hasDeadline: c.hasDeadline,
            deadlineText: c.deadlineText,
          });
        }
        console.log(`  [batch ${outcome.batchIndex + 1}/${batchCount}] ok — ${outcome.classifications.length} classified`);
      } else {
        await markEmailsUnclassified(outcome.unclassifiedEmailIds);
        console.log(
          `  [batch ${outcome.batchIndex + 1}/${batchCount}] FAILED — ${outcome.error} (${outcome.unclassifiedEmailIds.length} marked unclassified)`,
        );
      }
    },
  });

  // Summarize from the DB, which proves the results actually persisted.
  const persisted = await listClassificationsForUser(user.id);
  const counts = new Map<string, number>();
  const samples: string[] = [];
  for (const row of persisted) {
    const label = row.status === 'unclassified' ? 'Unclassified' : row.bucket ?? 'Unclassified';
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (samples.length < 5 && row.status === 'classified' && row.justification) {
      samples.push(`  • [${row.bucket}] ${row.subject ?? '(no subject)'} — "${row.justification}"`);
    }
  }

  console.log('\n──────────────────────────────────────────────');
  console.log('Bucket distribution (from the database):');
  for (const [label, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(14)} ${count}`);
  }
  console.log('\nSample justifications:');
  console.log(samples.join('\n'));

  const ambiguous = result.classifications.filter((c) => c.isAmbiguous).length;
  console.log(`\nAmbiguous (low-confidence or secondary bucket): ${ambiguous}`);
  console.log(`Unclassified this run: ${result.unclassifiedEmailIds.length}`);
  console.log(
    `Spend: ${fmtUsd(result.actualCostUsd)} ` +
      `(${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, ${result.durationMs}ms)`,
  );
  console.log('Re-run to confirm idempotency — the unique(emailId) constraint replaces rows, never duplicates.');
  console.log('──────────────────────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error('classify:dev failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
