/**
 * Phase 9a proof script (docs/AGENTIC_CHAT_PLAN.md: "prove it with a script/curl before any
 * frontend exists" — there's no HTTP route yet, so this direct dev script IS that proof, same role
 * scripts/classify-dev.ts played for Phase 2's classification pipeline).
 *
 * Runs one user turn against a real user's already-synced, already-classified inbox and prints the
 * reply, every tool call made, and whether the iteration cap was hit.
 *
 *   npm run agent:dev -- --query "emails from Sarah about the contract"
 *   npm run agent:dev -- --email you@example.com --query "..."
 *   npm run agent:dev -- --query "email from John" --history .agent-history.json
 *   npm run agent:dev -- --query "actually the one about the lease" --history .agent-history.json
 *
 * --history <path> loads prior turns from that file (if it exists) and overwrites it with the
 * updated history afterward, so re-running with the same path continues one conversation — how to
 * script the ambiguous-sender clarification round trip (verification gate scenario 2).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/client.js';
import { findUserByEmail, listUsers } from '../db/queries/users.js';
import { runAgentTurn } from '../services/agent/index.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return { email: get('--email'), query: get('--query'), historyPath: get('--history') };
}

async function main() {
  const { email, query, historyPath } = parseArgs();
  if (!query) {
    console.error('Usage: npm run agent:dev -- --query "..." [--email you@example.com] [--history path.json]');
    process.exitCode = 1;
    return;
  }

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

  let history: Anthropic.MessageParam[] = [];
  if (historyPath && existsSync(historyPath)) {
    history = JSON.parse(readFileSync(historyPath, 'utf-8')) as Anthropic.MessageParam[];
  }

  console.log(`\nUser: ${user.email}`);
  console.log(`Query: ${query}`);
  if (history.length > 0) console.log(`(continuing a conversation with ${history.length} prior message(s))`);

  const start = Date.now();
  const result = await runAgentTurn(user.id, history, query);
  const durationMs = Date.now() - start;

  console.log('\n──────────────────────────────────────────────');
  console.log('Tool calls:');
  if (result.toolCalls.length === 0) {
    console.log('  (none — answered directly)');
  } else {
    for (const call of result.toolCalls) {
      console.log(`  • ${call.name}(${JSON.stringify(call.input)}) → ${call.resultSummary}`);
    }
  }
  console.log('\nReply:');
  console.log(result.reply);
  console.log(`\nIteration cap hit: ${result.hitIterationCap}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log('──────────────────────────────────────────────\n');

  if (historyPath) {
    writeFileSync(historyPath, JSON.stringify(result.history, null, 2));
    console.log(`History saved to ${historyPath} — re-run with the same --history to continue this conversation.\n`);
  }
}

main()
  .catch((err) => {
    console.error('agent:dev failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
