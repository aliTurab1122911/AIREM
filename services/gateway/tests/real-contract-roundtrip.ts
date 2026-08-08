import { readFile } from 'node:fs/promises';
import {
  documentUploadResponseSchema,
  rangeSelectionRequestSchema,
  extractionResponseSchema,
  rewriteRequestSchema,
  rewriteCycleRequestSchema,
  rewriteResponseSchema,
  validationRequestSchema,
  validationResponseSchema,
  reinsertionRequestSchema,
  reinsertionResponseSchema,
  textRewriteRequestSchema,
  textRewriteResponseSchema,
} from '@airem/contracts';
import { buildApp } from '../src/app.js';
import type { GatewayStore } from '../src/store.js';

class ContractStore implements GatewayStore {
  private readonly owners = new Map<string, string>();
  async sessionUser(session: string) { return session === 'contract-session' ? 'contract-user' : undefined; }
  async owns(userId: string, jobId: string) { return this.owners.get(jobId) === userId; }
  async claim(userId: string, jobId: string) { this.owners.set(jobId, userId); }
  async addUsage() { return true; }
}

const origin = process.env.FLASK_ORIGIN ?? 'http://127.0.0.1:5000';
const fixture = process.env.CONTRACT_DOCX ?? 'docs/sample_1_org.docx';
const cfg: any = {
  COOKIE_SECRET: 'contract-test-cookie-secret-at-least-32-characters',
  FLASK_ORIGIN: origin, REDIS_URL: 'redis://127.0.0.1:6379', USER_JOB_CONCURRENCY: 2,
  WORKER_CONCURRENCY: 1, JOB_TTL_HOURS: 1, PORT: 4101, NODE_ENV: 'test',
  UPLOAD_MAX_BYTES: 8 * 1024 * 1024, UPSTREAM_HEADERS_TIMEOUT_MS: 10_000,
  UPSTREAM_BODY_TIMEOUT_MS: 120_000, RATE_LIMIT_MAX: 600,
};
const app = await buildApp(new ContractStore(), cfg);
await app.listen({ host: '127.0.0.1', port: 4101 });
const auth = { cookie: 'session=contract-session' };
const jsonHeaders = { ...auth, 'content-type': 'application/json' };

async function json(response: Response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text) as unknown;
}

try {
  const bytes = await readFile(fixture);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.set('docx_file', new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'contract.docx');
  const uploadRaw = await json(await fetch('http://127.0.0.1:4101/api/documents/upload', { method: 'POST', headers: auth, body: form }));
  const upload = documentUploadResponseSchema.parse(uploadRaw);
  const jobId = upload.job_id;

  // This payload is the exact object React is allowed to serialize.
  const selection = rangeSelectionRequestSchema.parse({ selection_mode: 'automatic', include_headings: false, include_captions: false, include_table_headers: false });
  const extractRaw = await json(await fetch(`http://127.0.0.1:4101/api/ranges/${jobId}/extract`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(selection) }));
  const extraction = extractionResponseSchema.parse(extractRaw);
  if (!extraction.chunks.length) throw new Error('extraction produced no chunks');

  const rewriteRequest = rewriteRequestSchema.parse({ profile: 'natural', engine: 'linguistic', style_profile: 'natural_student', protected_terms: ['AIREM'] });
  const rewriteRaw = await json(await fetch(`http://127.0.0.1:4101/api/rewrite/${jobId}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(rewriteRequest) }));
  const rewrite = rewriteResponseSchema.parse(rewriteRaw);

  // No adapter transform is allowed to flatten, rename or discard this map.
  const cycleRequest = rewriteCycleRequestSchema.parse({ ...rewriteRequest, edited_texts: rewrite.edited_texts });
  const cycleRaw = await json(await fetch(`http://127.0.0.1:4101/api/rewrite/${jobId}/cycles`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(cycleRequest) }));
  const cycle = rewriteResponseSchema.parse(cycleRaw);
  if (!Object.keys(cycle.edited_texts).length) throw new Error('cycle lost edited_texts');

  const validationRequest = validationRequestSchema.parse({ edited_texts: cycle.edited_texts });
  const validationRaw = await json(await fetch(`http://127.0.0.1:4101/api/validation/${jobId}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(validationRequest) }));
  const validation = validationResponseSchema.parse(validationRaw);
  if (!validation.validation.valid) throw new Error('mapped cycle output did not validate');

  const reinsertionRequest = reinsertionRequestSchema.parse({ edited_texts: cycle.edited_texts });
  const reinsertRaw = await json(await fetch(`http://127.0.0.1:4101/api/reinsertion/${jobId}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(reinsertionRequest) }));
  const reinsert = reinsertionResponseSchema.parse(reinsertRaw);

  const pasteRequest = textRewriteRequestSchema.parse({ text: 'It is important to note that the system is capable of providing an explanation.', profile: 'rewrite_compress', style_profile: 'plain_professional' });
  const pasteRaw = await json(await fetch('http://127.0.0.1:4101/api/text/rewrite', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(pasteRequest) }));
  const paste = textRewriteResponseSchema.parse(pasteRaw);

  console.log(JSON.stringify({
    ok: true, jobId, chunkCount: extraction.chunks.length,
    rewriteProfile: rewrite.profile, cycleNumber: cycle.cycle_number,
    validationValid: validation.validation.valid, replacementCount: reinsert.replacement_count,
    pasteProfile: paste.profile,
  }));
} finally {
  await app.close();
}
