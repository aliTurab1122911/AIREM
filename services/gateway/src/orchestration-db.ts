import type pg from 'pg';

export type CompletionStatus = 'completed' | 'review_required' | 'cancelled' | 'allowance_exceeded' | 'already_terminal' | 'missing';

export async function claimOrchestrationJob(pool: pg.Pool, id: string, attempt: number) {
  const result = await pool.query(
    `UPDATE orchestration_jobs
       SET state='processing', progress=10, attempt=$2,
           started_at=coalesce(started_at,now()), updated_at=now(),
           error_code=NULL, error_message=NULL
     WHERE id=$1 AND state IN ('queued','processing') AND cancel_requested_at IS NULL
     RETURNING *`,
    [id, attempt],
  );
  return result.rows[0];
}

export async function setOrchestrationProgress(pool: pg.Pool, id: string, progress: number) {
  const bounded = Math.max(0, Math.min(99, Math.trunc(progress)));
  await pool.query(
    `UPDATE orchestration_jobs SET progress=$2,updated_at=now()
      WHERE id=$1 AND state='processing' AND cancel_requested_at IS NULL`,
    [id, bounded],
  );
}

export async function orchestrationCancellationRequested(pool: pg.Pool, id: string) {
  const result = await pool.query('SELECT cancel_requested_at FROM orchestration_jobs WHERE id=$1', [id]);
  return Boolean(result.rows[0]?.cancel_requested_at);
}

/**
 * Atomically publish a successful processor result and charge usage exactly once.
 *
 * The usage-charge row is unique by orchestration job ID. Account usage and the
 * monthly history row are updated in the same transaction as the terminal job
 * state, so a BullMQ retry after a lost acknowledgement cannot charge twice.
 */
export async function completeOrchestrationJob(
  pool: pg.Pool,
  input: { id: string; result: unknown; words: number; reviewRequired: boolean; ttlHours: number },
): Promise<CompletionStatus> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM orchestration_jobs WHERE id=$1 FOR UPDATE', [input.id]);
    const job = locked.rows[0];
    if (!job) { await client.query('COMMIT'); return 'missing'; }
    if (!['queued', 'processing'].includes(job.state)) { await client.query('COMMIT'); return 'already_terminal'; }

    if (job.cancel_requested_at) {
      await client.query(
        `UPDATE orchestration_jobs
            SET state='failed',progress=100,error_code='CANCELLED',error_message='Cancelled by user.',
                result=NULL,finished_at=now(),updated_at=now()
          WHERE id=$1`, [input.id],
      );
      await client.query('COMMIT');
      return 'cancelled';
    }

    const words = Number.isSafeInteger(input.words) && input.words > 0 ? input.words : 0;
    if (words > 0) {
      const usage = await client.query(
        'SELECT words_used,word_allowance,period_start FROM account_usage WHERE user_id=$1 FOR UPDATE',
        [job.user_id],
      );
      const account = usage.rows[0];
      if (!account || Number(account.words_used) + words > Number(account.word_allowance)) {
        await client.query(
          `UPDATE orchestration_jobs
              SET state='failed',progress=100,error_code='WORD_ALLOWANCE_EXCEEDED',
                  error_message='Word allowance exceeded.',result=NULL,word_count=NULL,
                  finished_at=now(),updated_at=now()
            WHERE id=$1`, [input.id],
        );
        await client.query('COMMIT');
        return 'allowance_exceeded';
      }

      const charged = await client.query(
        `INSERT INTO orchestration_usage_charges(job_id,user_id,words)
         VALUES($1,$2,$3) ON CONFLICT(job_id) DO NOTHING RETURNING words`,
        [input.id, job.user_id, words],
      );
      if (charged.rowCount) {
        await client.query(
          'UPDATE account_usage SET words_used=words_used+$2,updated_at=now() WHERE user_id=$1',
          [job.user_id, words],
        );
        await client.query(
          `INSERT INTO usage_history(user_id,month_start,words_processed)
           VALUES($1,$2,$3)
           ON CONFLICT(user_id,month_start)
           DO UPDATE SET words_processed=usage_history.words_processed+EXCLUDED.words_processed`,
          [job.user_id, account.period_start, words],
        );
      }
    }

    await client.query(
      `INSERT INTO orchestration_outputs(job_id,user_id,metadata,expires_at)
       VALUES($1,$2,$3,now()+make_interval(hours=>$4))
       ON CONFLICT(job_id) DO NOTHING`,
      [input.id, job.user_id, input.result, input.ttlHours],
    );
    const state = input.reviewRequired ? 'review_required' : 'completed';
    await client.query(
      `UPDATE orchestration_jobs
          SET state=$2,progress=100,result=$3,word_count=$4,finished_at=now(),updated_at=now(),
              output_id=(SELECT id FROM orchestration_outputs WHERE job_id=$1),
              error_code=NULL,error_message=NULL
        WHERE id=$1`,
      [input.id, state, input.result, words || null],
    );
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function failOrRetryOrchestrationJob(
  pool: pg.Pool,
  input: { id: string; attempt: number; maxAttempts: number; transient: boolean; status?: number; internalError: string },
) {
  const cancelRequested = await orchestrationCancellationRequested(pool, input.id);
  if (cancelRequested) {
    await pool.query(
      `UPDATE orchestration_jobs
          SET state='failed',progress=100,error_code='CANCELLED',error_message='Cancelled by user.',
              finished_at=now(),updated_at=now()
        WHERE id=$1 AND state IN ('queued','processing')`, [input.id],
    );
    return { final: true, code: 'CANCELLED' as const };
  }

  const final = !input.transient || input.attempt >= input.maxAttempts;
  const message = input.status === 429
    ? 'The processing service is busy; retry attempts were exhausted.'
    : 'We could not process this job. Please try again later.';
  await pool.query(
    `UPDATE orchestration_jobs
        SET state=CASE WHEN $2 THEN 'failed'::orchestration_job_state ELSE 'queued'::orchestration_job_state END,
            progress=CASE WHEN $2 THEN progress ELSE 0 END,
            error_code=$3,error_message=$4,internal_error=$5,
            finished_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now()
      WHERE id=$1 AND state IN ('queued','processing')`,
    [input.id, final, final ? 'PROCESSING_FAILED' : 'TRANSIENT_RETRY', message, input.internalError],
  );
  return { final, code: final ? 'PROCESSING_FAILED' as const : 'TRANSIENT_RETRY' as const };
}
