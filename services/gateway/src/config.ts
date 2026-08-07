import { z } from 'zod';

export const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  COOKIE_SECRET: z.string().min(32),
  FLASK_ORIGIN: z.string().url().default('http://processor:5000'),
  REDIS_URL: z.string().url().default('redis://redis:6379'),
  USER_JOB_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  JOB_TTL_HOURS: z.coerce.number().int().positive().default(72),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  UPSTREAM_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  UPSTREAM_BODY_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
});
export type Config = z.infer<typeof configSchema>;
export const loadConfig = (): Config => configSchema.parse(process.env);
