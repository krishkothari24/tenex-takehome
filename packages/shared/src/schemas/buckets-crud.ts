import { z } from 'zod';
import { bucketSchema } from './classification.js';

/** `POST /api/buckets` — name only. Description/color are server-assigned (see build guide §6's
 *  "type a name, hit enter" custom-bucket flow). */
export const createBucketRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreateBucketRequest = z.infer<typeof createBucketRequestSchema>;

export const createBucketResponseSchema = z.object({ bucket: bucketSchema });
export type CreateBucketResponse = z.infer<typeof createBucketResponseSchema>;
