import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root .env, regardless of the cwd the server process is launched from.
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_REDIRECT_URI: z.string().url('GOOGLE_REDIRECT_URI must be a valid URL'),
  SESSION_SECRET: z
    .string()
    .min(1, 'SESSION_SECRET is required')
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message:
        'SESSION_SECRET must decode (base64) to exactly 32 bytes (crypto_secretbox_KEYBYTES for @fastify/secure-session)',
    }),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(1, 'TOKEN_ENCRYPTION_KEY is required')
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes (AES-256)',
    }),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  ANTHROPIC_API_KEY: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Environment validation failed — see above for details.');
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
