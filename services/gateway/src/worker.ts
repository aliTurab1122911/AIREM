import { Worker, UnrecoverableError, type Job } from 'bullmq';
import pg from 'pg';
import { request } from 'undici';
import { readdir, rm, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { loadConfig } from './config.js';
import { JOB_QUEUE, redisConnection } from './jobs.js';
import { queuedProcessorCall } from './orchestration.js';
import {
  claimOrchestrationJob,
  completeOrchestrationJob,
  failOrRetryOrchestrationJob,
  setOrchestrationProgress,
} from './orchestration-db.js';
import { usageWords } from './usage.js';

const cfg = loadConfig();
const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL });
const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientCodes = new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);

function reviewRequired(operation: string, result: unknown) {
  if (!result || typeof result !== 'object') return false;
  const value = result as Record<string, any>;
  if (value.review_required === true) return true;
  if (operation === 'document_validation') return value.ok === false || value.validation?.valid === false;
  return false;
}

function isTransient(error: any) {
  if (typeof error?.transient === 'boolean') return error.transient;
  return transientCodes.has(String(error?.code ?? '').toUpperCase());
}

async function progress(job: Job, value: number) {
  await Promise.all([
    job.updateProgress(value),
    setOrchestrationProgress(pool, String(job.data.id), value),
  ]);
}

async function run(bullJob: Job) {
  const id = String(bullJob.data.id);
  const attempt = bullJob.attemptsMade + 1;
  const claimed = await claimOrchestrationJob(pool, id, attempt);
  if (!claimed) return;

  try {
    const call = queuedProcessorCall(claimed.operation, claimed.request);
    await progress(bullJob, 25);
    const response = await request(new URL(call.path, cfg.FLASK_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestration-job-id': id,
        'x-orchestration-attempt': String(attempt),
      },
      body: JSON.stringify(call.body),
      headersTimeout: cfg.UPSTREAM_HEADERS_TIMEOUT_MS,
      bodyTimeout: cfg.UPSTREAM_BODY_TIMEOUT_MS,
    });
    const raw = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Object.assign(new Error(`processor status ${response.statusCode}`), {
        transient: transientStatuses.has(response.statusCode),
        status: response.statusCode,
      });
    }

    let result: unknown;
    try { result = JSON.parse(raw); }
    catch {
      throw Object.assign(new Error('processor returned non-JSON metadata'), { transient: false });
    }
    await progress(bullJob, 80);

    const words = usageWords(call.usageKind, result);
    const completion = await completeOrchestrationJob(pool, {
      id,
      result,
      words,
      reviewRequired: reviewRequired(claimed.operation, result),
      ttlHours: cfg.JOB_TTL_HOURS,
    });
    await bullJob.updateProgress(100);

    if (completion === 'allowance_exceeded') {
      throw Object.assign(new Error('word allowance exceeded'), { transient: false, terminalAlreadyRecorded: true });
    }
  } catch (error: any) {
    if (error?.terminalAlreadyRecorded) throw new UnrecoverableError('word allowance exceeded');
    const outcome = await failOrRetryOrchestrationJob(pool, {
      id,
      attempt,
      maxAttempts: Number(claimed.max_attempts ?? 3),
      transient: isTransient(error),
      status: error?.status,
      internalError: String(error?.stack ?? error),
    });
    if (outcome.final) throw new UnrecoverableError(outcome.code === 'CANCELLED' ? 'cancelled' : 'non-retryable processor failure');
    throw error;
  }
}

const worker = new Worker(JOB_QUEUE, run, {
  connection: redisConnection(cfg.REDIS_URL),
  concurrency: cfg.WORKER_CONCURRENCY,
});
worker.on('failed', (job, error) => console.error(JSON.stringify({
  event: 'job_failed', jobId: job?.id, attempt: job?.attemptsMade, error: error.stack,
})));

async function cleanup() {
  await pool.query("UPDATE orchestration_jobs SET state='expired',result=NULL,updated_at=now() WHERE expires_at<now() AND state IN ('completed','failed','review_required')");
  await pool.query('DELETE FROM orchestration_outputs WHERE expires_at<now()');
  await pool.query("DELETE FROM sessions WHERE expires_at<now()-interval '24 hours'");
  await pool.query("DELETE FROM password_resets WHERE expires_at<now()-interval '24 hours'");
  const root = process.env.TEMP_UPLOAD_ROOT;
  if (root) {
    const full = resolve(root);
    if (full.startsWith('/tmp' + sep)) {
      for (const name of await readdir(full).catch(() => [])) {
        const path = resolve(full, name);
        if (path.startsWith(full + sep) && Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000) {
          await rm(path, { recursive: true, force: true });
        }
      }
    }
  }
}
const timer = setInterval(() => void cleanup(), 60 * 60 * 1000);
timer.unref();
void cleanup();

const shutdown = async () => { clearInterval(timer); await worker.close(); await pool.end(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
