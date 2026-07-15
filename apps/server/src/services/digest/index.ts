export { generateDigest } from './generate.js';
export type { GeneratedDigest, DigestActionItem } from './generate.js';
export { selectDigestInput } from './select-input.js';
export type { DigestCandidateEmail } from './select-input.js';
export {
  DIGEST_MODEL,
  MAX_DIGEST_INPUT_EMAILS,
  DEFAULT_DIGEST_COST_CEILING_USD,
  digestCostCeilingUsd,
} from './config.js';
export { DigestGenerationError, DigestCostCeilingExceededError } from './errors.js';
