import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, isInsufficientCreditsError } from '../classifier/anthropic.js';
import { estimateTokensFromChars } from '../classifier/cost.js';
import { isDryRun } from '../classifier/config.js';
import { InsufficientCreditsError } from '../classifier/errors.js';
import { DIGEST_MODEL, MAX_DIGEST_OUTPUT_TOKENS, digestCostCeilingUsd } from './config.js';
import { estimateDigestCostUsd } from './cost.js';
import { DigestCostCeilingExceededError, DigestGenerationError } from './errors.js';
import { buildDigestSystemPrompt, buildDigestTool, buildDigestUserMessage, DIGEST_TOOL_NAME } from './prompt.js';
import { selectDigestInput, type DigestCandidateEmail } from './select-input.js';
import { digestToolOutputSchema } from './validation.js';

export interface DigestActionItem {
  emailId: string;
  title: string;
  why: string;
  urgency: 'high' | 'medium' | 'low';
  draftReply: string | null;
}

export interface GeneratedDigest {
  headline: string;
  actionItems: DigestActionItem[];
  fyiCount: number;
  inputEmailCount: number;
  costUsd: number;
}

const EMPTY_DIGEST: GeneratedDigest = {
  headline: 'Nothing urgent this week — your shortlist is empty.',
  actionItems: [],
  fyiCount: 0,
  inputEmailCount: 0,
  costUsd: 0,
};

function extractToolInput(message: Anthropic.Message): unknown {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === DIGEST_TOOL_NAME,
  );
  if (!block) throw new Error('model did not return the expected tool call');
  return block.input;
}

/**
 * One on-demand Sonnet 5 call — not a scheduled job (CLAUDE.md: streaming, not background job
 * infra). Degenerate input (nothing salient this week) short-circuits before any API call, same
 * instinct as the classifier's empty-input branch. Retry-once-then-fail-loud on validation
 * failure, same shape as classifyBatch.
 */
export async function generateDigest(candidates: DigestCandidateEmail[]): Promise<GeneratedDigest> {
  const selected = selectDigestInput(candidates);
  if (selected.length === 0) return EMPTY_DIGEST;

  const validEmailIds = selected.map((e) => e.emailId);
  const system = buildDigestSystemPrompt();
  const tool = buildDigestTool(validEmailIds);
  const schema = digestToolOutputSchema(validEmailIds);
  const baseUserMessage = buildDigestUserMessage(selected);

  // Guardrail: pre-flight worst-case cost ceiling. If this trips, nothing is spent.
  const overheadChars = system.length + JSON.stringify(tool).length + baseUserMessage.length;
  const estimatedInputTokens = estimateTokensFromChars(overheadChars) * 2; // initial + one retry
  const estimatedOutputTokens = MAX_DIGEST_OUTPUT_TOKENS * 2;
  const estimatedCostUsd = estimateDigestCostUsd({
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  });
  const ceiling = digestCostCeilingUsd();
  if (estimatedCostUsd > ceiling) {
    throw new DigestCostCeilingExceededError(estimatedCostUsd, ceiling);
  }

  // Global dry-run kill switch (shared with the classifier) — exercise the plumbing at $0.
  if (isDryRun()) {
    return { ...EMPTY_DIGEST, headline: 'Dry run — no API call made.', inputEmailCount: selected.length };
  }

  const client = getAnthropicClient();
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const userMessage =
      attempt === 0
        ? baseUserMessage
        : `${baseUserMessage}\n\nYour previous attempt was rejected: ${lastError}\nFix that and record the digest again. Every emailId must still be exactly one of the ids listed above.`;

    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: DIGEST_MODEL,
        max_tokens: MAX_DIGEST_OUTPUT_TOKENS,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: DIGEST_TOOL_NAME, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      // Not retryable and won't resolve on the corrective-retry path below — fail immediately.
      if (isInsufficientCreditsError(err)) throw new InsufficientCreditsError();
      throw err;
    }

    // A response cut off mid-tool-call fails validation with a confusing "field X is missing"
    // error that doesn't tell the model what actually went wrong (it ran out of output budget,
    // not that it forgot a field) — surface the real cause so the retry can act on it instead.
    if (message.stop_reason === 'max_tokens') {
      lastError =
        'the response was cut off because it hit the output token limit before the tool call finished. Write fewer action items and/or shorter `why`/`draftReply` text so the full digest fits.';
      continue;
    }

    try {
      const parsed = schema.parse(extractToolInput(message));
      return {
        headline: parsed.headline,
        actionItems: parsed.actionItems,
        fyiCount: parsed.fyiCount,
        inputEmailCount: selected.length,
        costUsd: estimateDigestCostUsd({
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        }),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new DigestGenerationError(lastError);
}
