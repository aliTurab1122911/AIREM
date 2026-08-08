import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp, type Upstream } from '../src/app.js';
import type { GatewayStore } from '../src/store.js';

const aliceJob = '11111111-1111-4111-8111-111111111111';
const cfg: any = { COOKIE_SECRET: 'test-cookie-secret-that-is-long-enough', FLASK_ORIGIN: 'http://processor:5000', PORT: 4000, NODE_ENV: 'test', UPLOAD_MAX_BYTES: 1024 * 1024, UPSTREAM_HEADERS_TIMEOUT_MS: 1000, UPSTREAM_BODY_TIMEOUT_MS: 1000, RATE_LIMIT_MAX: 100 };

class MemoryStore implements GatewayStore {
  sessions = new Map([['alice-session', 'alice'], ['bob-session', 'bob']]);
  jobs = new Map([[aliceJob, 'alice']]);
  usage: [string, number][] = [];
  async sessionUser(value: string) { return this.sessions.get(value); }
  async owns(user: string, job: string) { return this.jobs.get(job) === user; }
  async claim(user: string, job: string) { if (!this.jobs.has(job)) this.jobs.set(job, user); }
  async addUsage(user: string, words: number) { this.usage.push([user, words]); return true; }
}

const response = (body = '{}', headers: Record<string, string> = {}) => ({ statusCode: 200, headers: { 'content-type': 'application/json', ...headers }, body: Readable.from(body) });

describe('gateway account isolation', () => {
  it('applies RATE_LIMIT_MAX and a stricter processing limit at runtime', async () => {
    const limited = { ...cfg, RATE_LIMIT_MAX: 2 };
    const app = await buildApp(new MemoryStore(), limited, async () => response());
    const headers = { cookie: 'session=alice-session' };
    expect((await app.inject({ method: 'GET', url: '/api/rewrite/profiles', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/rewrite/profiles', headers })).statusCode).toBe(200);
    const standardLimited = await app.inject({ method: 'GET', url: '/api/rewrite/profiles', headers });
    expect(standardLimited.statusCode).toBe(429);
    expect(standardLimited.json().error.code).toBe('RATE_LIMITED');
    await app.close();

    const processingApp = await buildApp(new MemoryStore(), { ...cfg, RATE_LIMIT_MAX: 6 }, async () => response());
    const jobRequest = { method: 'POST' as const, url: '/api/jobs', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': 'request-123' }, payload: JSON.stringify({ operation: 'text_rewrite', payload: {} }) };
    expect((await processingApp.inject(jobRequest)).statusCode).toBe(400);
    const processingLimited = await processingApp.inject(jobRequest);
    expect(processingLimited.statusCode).toBe(429);
    expect(processingLimited.json().error.code).toBe('RATE_LIMITED');
    await processingApp.close();
  });

  it('requires a valid account session for every processing namespace', async () => {
    const app = await buildApp(new MemoryStore(), cfg, async () => response());
    for (const [method, path] of [['GET', '/api/documents/jobs/x'], ['POST', '/api/rewrite/x'], ['POST', '/api/detection/text'], ['POST', '/api/formatting/analyse']] as const) {
      expect((await app.inject({ method, url: path })).statusCode).toBe(401);
    }
    await app.close();
  });

  it.each([
    ['view', `/api/documents/jobs/${aliceJob}`, 'GET'],
    ['rewrite', `/api/rewrite/${aliceJob}`, 'POST'],
    ['preview', `/api/documents/preview/${aliceJob}/result.pdf`, 'GET'],
    ['download', `/api/documents/download/${aliceJob}/result.docx`, 'GET'],
  ])('does not let Bob %s Alice\'s job', async (_operation, path, method) => {
    let upstreamCalls = 0;
    const app = await buildApp(new MemoryStore(), cfg, async () => { upstreamCalls++; return response(); });
    const result = await app.inject({ method, url: path, headers: { cookie: 'session=bob-session' }, payload: method === 'POST' ? '{}' : undefined });
    expect(result.statusCode).toBe(404);
    expect(result.json().error.code).toBe('JOB_NOT_FOUND');
    expect(upstreamCalls).toBe(0);
    await app.close();
  });

  it('claims a returned Flask UUID and increments usage only after success', async () => {
    const store = new MemoryStore();
    const job = '22222222-2222-4222-8222-222222222222';
    const upstream: Upstream = async () => response(JSON.stringify({ job_id: job }), { 'x-airem-words-processed': '17' });
    const app = await buildApp(store, cfg, upstream);
    const result = await app.inject({ method: 'POST', url: '/api/documents/upload', headers: { cookie: 'session=alice-session', 'content-type': 'application/octet-stream' }, payload: 'metadata' });
    expect(result.statusCode).toBe(200);
    expect(store.jobs.get(job)).toBe('alice');
    expect(store.usage).toEqual([['alice', 17]]);
    await app.close();
  });

  it('streams downloads through the adapter with unchanged bytes', async () => {
    const bytes = Buffer.from('docx-binary');
    const app = await buildApp(new MemoryStore(), cfg, async () => ({ statusCode: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': 'attachment; filename=result.docx' }, body: Readable.from(bytes) }));
    const result = await app.inject({ method: 'GET', url: `/api/documents/download/${aliceJob}/result.docx`, headers: { cookie: 'session=alice-session' } });
    expect(result.rawPayload).toEqual(bytes);
    await app.close();
  });
});
