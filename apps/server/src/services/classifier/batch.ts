import type Anthropic from '@anthropic-ai/sdk';
import type { EmailClassification } from '@inbox-concierge/shared';
import { getAnthropicClient } from './anthropic.js';
import { CLASSIFIER_MODEL, MAX_OUTPUT_TOKENS_PER_CALL } from './config.js';
import { deriveAmbiguity } from './derive.js';
import { BatchClassificationError } from './errors.js';
import { buildBatchUserMessage, buildClassifyTool, buildSystemPrompt, TOOL_NAME } from './prompt.js';
import type { BucketDef, ClassifierEmail, TokenUsage } from './types.js';
import { classificationBatchSchema, type ParsedItem } from './validation.js';

function extractToolInput(message: Anthropic.Message): unknown {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
  );
  if (!block) throw new Error('model did not return the expected tool call');
  return block.input;
}

/** Derive the two computed fields (§5.4 justification is passed through; §5.5 ambiguity here). */
function toClassification(item: ParsedItem, emailId: string): EmailClassification {
  const { secondaryBucket, isAmbiguous } = deriveAmbiguity({
    bucket: item.bucket,
    confidence: item.confidence,
    secondaryBucket: item.secondaryBucket,
  });
  return {
    emailId,
    bucket: item.bucket,
    secondaryBucket,
    confidence: item.confidence,
    justification: item.justification,
    isAmbiguous,
    status: 'classified',
    estimatedReadMinutes: item.estimatedReadMinutes,
  };
}

/**
 * Classify one batch. Forces the tool call, validates the parsed input with Zod, and checks
 * completeness (every email covered exactly once). On any failure it retries EXACTLY once with a
 * corrective instruction; a second failure throws BatchClassificationError — the caller isolates
 * it and marks those emails `unclassified`. Never silently drops, never crashes the whole run.
 */
export async function classifyBatch(
  emails: ClassifierEmail[],
  buckets: BucketDef[],
): Promise<{ classifications: EmailClassification[]; usage: TokenUsage }> {
  const client = getAnthropicClient();
  const bucketNames = buckets.map((b) => b.name);
  const system = buildSystemPrompt(buckets);
  const tool = buildClassifyTool(bucketNames);
  const schema = classificationBatchSchema(bucketNames);
  const baseUserMessage = buildBatchUserMessage(emails);
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const userMessage =
      attempt === 0
        ? baseUserMessage
        : `${baseUserMessage}\n\nYour previous attempt was rejected (${lastError}). Return exactly one entry per index 1..${emails.length}, each bucket from the allowed list, confidence between 0 and 1.`;

    const message = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS_PER_CALL,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: userMessage }],
    });
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;

    try {
      const parsed = schema.parse(extractToolInput(message));

      // Completeness: strict mode guarantees each item's shape, not that the model covered every
      // email exactly once. Enforce index coverage 1..N with no gaps, dupes, or strays.
      const byIndex = new Map<number, ParsedItem>();
      for (const item of parsed.classifications) {
        if (item.index < 1 || item.index > emails.length) {
          throw new Error(`index ${item.index} out of range 1..${emails.length}`);
        }
        if (byIndex.has(item.index)) throw new Error(`duplicate index ${item.index}`);
        byIndex.set(item.index, item);
      }
      if (byIndex.size !== emails.length) {
        throw new Error(`expected ${emails.length} classifications, got ${byIndex.size}`);
      }

      const classifications = emails.map((email, i) => toClassification(byIndex.get(i + 1)!, email.id));
      return { classifications, usage };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new BatchClassificationError(
    lastError,
    emails.map((e) => e.id),
    usage,
  );
}
