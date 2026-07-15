/**
 * Classification eval harness (build guide §5.7). Runs the real pipeline against the hand-labeled
 * fixture set and reports accuracy — overall, per-bucket, and a table of misses.
 *
 * Cost-safe by default: prints the estimate and makes NO API calls unless you pass `--confirm`.
 *   npm run eval             # dry run — cost estimate only, $0 spent
 *   npm run eval -- --confirm  # actually classify (~$0.005 for 18 fixtures)
 */
import { classifyEmails, estimateRun, isDryRun } from '../services/classifier/index.js';
import type { BucketDef, ClassifierEmail } from '../services/classifier/index.js';
import { DEFAULT_BUCKETS } from '../services/default-buckets.js';
import { EVAL_FIXTURES } from './fixtures.js';

const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const buckets: BucketDef[] = DEFAULT_BUCKETS.map((b) => ({ name: b.name, description: b.description }));
const emails: ClassifierEmail[] = EVAL_FIXTURES.map((f, i) => ({
  id: `fixture-${i}`,
  subject: f.subject,
  fromAddress: f.from,
  snippet: f.snippet,
}));

async function main() {
  const confirm = process.argv.slice(2).includes('--confirm');
  const { estimate, batchCount } = estimateRun(emails, buckets);

  console.log(`\nEval set: ${EVAL_FIXTURES.length} fixtures, ${batchCount} batch(es).`);
  console.log(
    `Worst-case cost estimate: ${fmtUsd(estimate.estimatedCostUsd)} ` +
      `(~${estimate.estimatedInputTokens} in / ${estimate.estimatedOutputTokens} out tokens).`,
  );

  if (!confirm) {
    console.log('\nDry run — no API calls made. Re-run with `--confirm` to classify.\n');
    return;
  }
  if (isDryRun()) {
    console.log('\nCLASSIFIER_DRY_RUN is set — skipping API calls; accuracy will read 0%.\n');
  }

  const result = await classifyEmails(emails, buckets);
  const byId = new Map(result.classifications.map((c) => [c.emailId, c]));

  let correct = 0;
  const perBucket = new Map<string, { correct: number; total: number }>();
  const misses: string[] = [];

  EVAL_FIXTURES.forEach((fixture, i) => {
    const predicted = byId.get(`fixture-${i}`);
    const predictedBucket = predicted?.bucket ?? '(unclassified)';
    const isCorrect = predictedBucket === fixture.expected;
    if (isCorrect) correct += 1;

    const stat = perBucket.get(fixture.expected) ?? { correct: 0, total: 0 };
    stat.total += 1;
    if (isCorrect) stat.correct += 1;
    perBucket.set(fixture.expected, stat);

    if (!isCorrect) {
      const conf = predicted?.confidence != null ? ` conf=${predicted.confidence.toFixed(2)}` : '';
      const why = predicted?.justification ? ` — "${predicted.justification}"` : '';
      misses.push(
        `  ✗ "${fixture.subject}"\n      expected ${fixture.expected}, got ${predictedBucket}${conf}${why}`,
      );
    }
  });

  const accuracy = correct / EVAL_FIXTURES.length;
  const ambiguous = result.classifications.filter((c) => c.isAmbiguous);

  console.log('\n──────────────────────────────────────────────');
  console.log(`Overall accuracy: ${pct(accuracy)} (${correct}/${EVAL_FIXTURES.length})`);
  console.log('\nPer-bucket:');
  for (const [bucket, s] of perBucket) {
    console.log(`  ${bucket.padEnd(14)} ${s.correct}/${s.total}  (${pct(s.correct / s.total)})`);
  }

  if (misses.length) {
    console.log('\nMisses:');
    console.log(misses.join('\n'));
  }

  console.log(`\nFlagged ambiguous: ${ambiguous.length}/${result.classifications.length}`);
  for (const c of ambiguous) {
    const idx = Number(c.emailId.replace('fixture-', ''));
    const secondary = c.secondaryBucket ? ` (secondary: ${c.secondaryBucket})` : '';
    const conf = c.confidence != null ? ` conf=${c.confidence.toFixed(2)}` : '';
    console.log(`  • "${EVAL_FIXTURES[idx]?.subject}" → ${c.bucket}${secondary}${conf}`);
  }

  if (result.unclassifiedEmailIds.length) {
    console.log(`\nUnclassified: ${result.unclassifiedEmailIds.length}`);
  }

  console.log(
    `\nActual spend: ${fmtUsd(result.actualCostUsd)} ` +
      `(${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, ${result.durationMs}ms)`,
  );
  console.log('──────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Eval failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
