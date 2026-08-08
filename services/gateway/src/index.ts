import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresGatewayStore } from './store.js';
import { RedisJobQueue } from './jobs.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const queue=new RedisJobQueue(config.REDIS_URL);
const app = await buildApp(new PostgresGatewayStore(pool), config, undefined, queue);
const shutdown = async () => { await app.close(); await queue.close(); await pool.end(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
await app.listen({ host: '0.0.0.0', port: config.PORT });
