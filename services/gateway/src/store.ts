import { createHash } from 'node:crypto';
import type pg from 'pg';

export const sessionHash = (value: string) => createHash('sha256').update(value).digest('hex');

export interface GatewayStore {
  sessionUser(session: string): Promise<string | undefined>;
  owns(userId: string, jobId: string): Promise<boolean>;
  claim(userId: string, jobId: string): Promise<void>;
  addUsage(userId: string, words: number): Promise<boolean>;
}

export class PostgresGatewayStore implements GatewayStore {
  constructor(private readonly pool: pg.Pool) {}
  async sessionUser(session: string) {
    const result = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id_hash=$1 AND expires_at > now()', [sessionHash(session)],
    );
    return result.rows[0]?.user_id;
  }
  async owns(userId: string, jobId: string) {
    const result = await this.pool.query(
      'SELECT 1 FROM flask_job_owners WHERE user_id=$1 AND job_id=$2', [userId, jobId],
    );
    return result.rowCount === 1;
  }
  async claim(userId: string, jobId: string) {
    await this.pool.query(
      'INSERT INTO flask_job_owners(job_id,user_id) VALUES($1,$2) ON CONFLICT(job_id) DO NOTHING',
      [jobId, userId],
    );
  }
  async addUsage(userId: string, words: number) {
    if (!Number.isSafeInteger(words) || words <= 0) return true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE account_usage SET words_used=words_used+$2, updated_at=now()
         WHERE user_id=$1 AND words_used+$2 <= word_allowance RETURNING user_id`, [userId, words],
      );
      if (result.rowCount !== 1) { await client.query('ROLLBACK'); return false; }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
