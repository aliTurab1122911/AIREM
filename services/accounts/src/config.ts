import { z } from 'zod';
export const configSchema = z.object({ DATABASE_URL:z.string().url(), COOKIE_SECRET:z.string().min(32), APP_ORIGIN:z.string().url(), PORT:z.coerce.number().int().min(1).max(65535).default(4000), NODE_ENV:z.enum(['development','test','production']).default('development'), SESSION_TTL_HOURS:z.coerce.number().positive().default(168), TOKEN_TTL_MINUTES:z.coerce.number().positive().default(30), DEFAULT_WORD_ALLOWANCE:z.coerce.number().int().nonnegative().default(10000) });
export type Config=z.infer<typeof configSchema>;
export const loadConfig=():Config=>configSchema.parse(process.env);
