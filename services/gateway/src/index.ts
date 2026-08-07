import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresGatewayStore } from './store.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const app = buildApp(new PostgresGatewayStore(pool), config);
const shutdown = async () => { await app.close(); await pool.end(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
await app.listen({ host: '0.0.0.0', port: config.PORT });
