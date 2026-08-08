import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';

const service = 'accounts';
const migrationsDirectory = new URL('../migrations/', import.meta.url);
const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS airem_schema_migrations (
      service text NOT NULL,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (service, name)
    )
  `);

  const migrations = (await readdir(migrationsDirectory))
    .filter(name => name.endsWith('.sql'))
    .sort();
  if (migrations.length === 0) throw new Error('No account SQL migrations were found');

  for (const name of migrations) {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('airem:accounts:migrations'))");
      const applied = await client.query(
        'SELECT 1 FROM airem_schema_migrations WHERE service = $1 AND name = $2',
        [service, name],
      );
      if (applied.rowCount === 0) {
        await client.query(await readFile(new URL(name, migrationsDirectory), 'utf8'));
        await client.query(
          'INSERT INTO airem_schema_migrations(service, name) VALUES ($1, $2)',
          [service, name],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
