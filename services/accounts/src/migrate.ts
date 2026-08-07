import pg from 'pg'; import { drizzle } from 'drizzle-orm/node-postgres'; import { migrate } from 'drizzle-orm/node-postgres/migrator'; import { loadConfig } from './config.js';
const pool=new pg.Pool({connectionString:loadConfig().DATABASE_URL}); await migrate(drizzle(pool),{migrationsFolder:new URL('../migrations',import.meta.url).pathname}); await pool.end();
