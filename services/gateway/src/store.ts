import { createHash } from 'node:crypto';
import type pg from 'pg';

export const sessionHash = (value: string) => createHash('sha256').update(value).digest('hex');

export interface GatewayStore {
  sessionUser(session: string): Promise<string | undefined>;
  owns(userId: string, jobId: string): Promise<boolean>;
  claim(userId: string, jobId: string): Promise<void>;
  addUsage(userId: string, words: number): Promise<boolean>;
  createJob?(userId:string,key:string,operation:string,request:unknown,concurrency:number,ttlHours:number):Promise<{job:OrchestrationJob;created:boolean}|undefined>;
  getJob?(userId:string,id:string):Promise<OrchestrationJob|undefined>;
  listJobs?(userId:string):Promise<OrchestrationJob[]>;
  cancelJob?(userId:string,id:string):Promise<boolean>;
}
export type JobState='queued'|'processing'|'review_required'|'completed'|'failed'|'expired';
export interface OrchestrationJob {id:string;operation:string;state:JobState;progress:number;attempt:number;maxAttempts:number;errorCode?:string;errorMessage?:string;result?:unknown;createdAt:string;updatedAt:string;expiresAt:string}

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
  private publicJob(row:any):OrchestrationJob{return{id:row.id,operation:row.operation,state:row.state,progress:row.progress,attempt:row.attempt,maxAttempts:row.max_attempts,errorCode:row.error_code??undefined,errorMessage:row.error_message??undefined,result:row.result??undefined,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),expiresAt:row.expires_at.toISOString()};}
  async createJob(userId:string,key:string,operation:string,request:unknown,concurrency:number,ttlHours:number){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);const old=await c.query('SELECT * FROM orchestration_jobs WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);if(old.rows[0]){await c.query('COMMIT');return{job:this.publicJob(old.rows[0]),created:false};}const active=await c.query("SELECT count(*)::int count FROM orchestration_jobs WHERE user_id=$1 AND state IN ('queued','processing')",[userId]);if(active.rows[0].count>=concurrency){await c.query('ROLLBACK');return undefined;}const r=await c.query("INSERT INTO orchestration_jobs(id,user_id,idempotency_key,operation,request,expires_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,now()+make_interval(hours=>$5)) RETURNING *",[userId,key,operation,request,ttlHours]);await c.query('COMMIT');return{job:this.publicJob(r.rows[0]),created:true};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async getJob(userId:string,id:string){const r=await this.pool.query('SELECT * FROM orchestration_jobs WHERE user_id=$1 AND id=$2',[userId,id]);return r.rows[0]?this.publicJob(r.rows[0]):undefined;}
  async listJobs(userId:string){const r=await this.pool.query('SELECT * FROM orchestration_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',[userId]);return r.rows.map(x=>this.publicJob(x));}
  async cancelJob(userId:string,id:string){const r=await this.pool.query("UPDATE orchestration_jobs SET state='failed',error_code='CANCELLED',error_message='Cancelled before processing began.',cancel_requested_at=now(),finished_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 AND state='queued' RETURNING id",[id,userId]);return r.rowCount===1;}
}
