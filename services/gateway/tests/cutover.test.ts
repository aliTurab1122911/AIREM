import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp, type Upstream } from '../src/app.js';
import type { GatewayStore } from '../src/store.js';

const cfg: any = {
  COOKIE_SECRET: 'cutover-test-cookie-secret-at-least-thirty-two-characters',
  FLASK_ORIGIN: 'http://processor:5000', REDIS_URL: 'redis://redis:6379', PORT: 4000,
  NODE_ENV: 'test', UPLOAD_MAX_BYTES: 1024 * 1024, UPSTREAM_HEADERS_TIMEOUT_MS: 1000,
  UPSTREAM_BODY_TIMEOUT_MS: 1000, RATE_LIMIT_MAX: 100, USER_JOB_CONCURRENCY: 2, JOB_TTL_HOURS: 72,
};
const jobId = '11111111-1111-4111-8111-111111111111';
class Store implements GatewayStore {
  async sessionUser(value: string) { return value === 'session' ? 'user' : undefined; }
  async owns(userId: string, id: string) { return userId === 'user' && id === jobId; }
  async claim() {}
  async addUsage() { return true; }
}
const response = (body = '{}') => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: Readable.from(body) });
const headers = { cookie: 'session=session' };

describe('PR10 public route cutover', () => {
  it('loads rewrite profiles through the internal v1 resource', async () => {
    let upstreamPath = '';
    const upstream: Upstream = async args => { upstreamPath = args.path; return response(JSON.stringify({ profiles: [] })); };
    const app = await buildApp(new Store(), cfg, upstream);
    const result = await app.inject({ method: 'GET', url: '/api/rewrite/profiles', headers });
    expect(result.statusCode).toBe(200);
    expect(upstreamPath).toBe('/internal/v1/rewrite/profiles');
    await app.close();
  });

  it.each([
    `/download/${jobId}/result.docx`,
    `/preview/${jobId}/result.pdf`,
    `/api/openai/ranges/${jobId}/draft`,
  ])('does not expose retired compatibility route %s', async path => {
    let upstreamCalls = 0;
    const app = await buildApp(new Store(), cfg, async () => { upstreamCalls++; return response(); });
    const result = await app.inject({ method: path.startsWith('/api/openai') ? 'POST' : 'GET', url: path, headers: { ...headers, 'content-type': 'application/json' }, payload: path.startsWith('/api/openai') ? '{}' : undefined });
    expect(result.statusCode).toBe(404);
    expect(upstreamCalls).toBe(0);
    await app.close();
  });

  it('keeps the authenticated canonical download route', async () => {
    const bytes = Buffer.from('artifact');
    const app = await buildApp(new Store(), cfg, async args => {
      expect(args.path).toBe(`/download/${jobId}/result.docx`);
      return { statusCode: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': 'attachment; filename=result.docx' }, body: Readable.from(bytes) };
    });
    const result = await app.inject({ method: 'GET', url: `/api/documents/download/${jobId}/result.docx`, headers });
    expect(result.statusCode).toBe(200);
    expect(result.rawPayload).toEqual(bytes);
    await app.close();
  });
});
