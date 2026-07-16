import { z } from 'zod';
import { MAX_SNIPPET_CHARS, MAX_SUBJECT_CHARS } from './config.js';

/** Collapse whitespace and hard-cap length so a single giant email can't blow the token budget. */
export function truncate(value: string | null, max: number): string {
  if (!value) return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export function truncateSubject(subject: string | null): string {
  return truncate(subject, MAX_SUBJECT_CHARS) || '(no subject)';
}

export function truncateSnippet(snippet: string | null): string {
  return truncate(snippet, MAX_SNIPPET_CHARS);
}

/**
 * Zod schema for the model's tool output, given the valid bucket names. The tool's `strict: true`
 * already constrains `bucket` to the enum at the API layer; this is defense-in-depth and also
 * enforces the numeric range that JSON-schema strict mode can't express (confidence ∈ [0,1]).
 *
 * We key items by a 1-based `index` (the email's position in the batch) rather than making the
 * model transcribe a 36-char UUID — cheaper, and it removes a whole class of id-corruption bugs.
 */
export function classificationBatchSchema(bucketNames: string[]) {
  const bucketEnum = z.enum(bucketNames as [string, ...string[]]);
  const item = z.object({
    index: z.number().int().positive(),
    bucket: bucketEnum,
    confidence: z.number().min(0).max(1),
    justification: z.string().trim().min(1).max(240),
    secondaryBucket: z
      .union([bucketEnum, z.null()])
      .optional()
      .default(null),
    hasDeadline: z.boolean(),
    // Length guard mirrors justification's — a short grounded phrase, not a paragraph.
    deadlineText: z.string().trim().min(1).max(160).nullable(),
  })
    // A model that says hasDeadline but forgets to null-out deadlineText (or vice versa) is a
    // correctness bug worth rejecting (→ retried once) rather than silently persisting an
    // inconsistent pair — same "reject and retry" instinct as the rest of this schema.
    .refine((v) => v.hasDeadline === (v.deadlineText !== null), {
      message: 'deadlineText must be non-null exactly when hasDeadline is true',
    });
  return z.object({ classifications: z.array(item).min(1) });
}

export type ParsedBatch = z.infer<ReturnType<typeof classificationBatchSchema>>;
export type ParsedItem = ParsedBatch['classifications'][number];
