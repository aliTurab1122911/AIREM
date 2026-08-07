import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
const cfg = loadConfig(); const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL });
await pool.query(await readFile(new URL('../migrations/0001_gateway.sql', import.meta.url), 'utf8')); await pool.end();
