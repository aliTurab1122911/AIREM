import { readFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import type { GatewayStore } from '../src/store.js';

class TransportStore implements GatewayStore {
  private readonly owners = new Map<string, string>();
  async sessionUser(session: string) { return session === 'transport-session' ? 'transport-user' : undefined; }
  async owns(userId: string, jobId: string) { return this.owners.get(jobId) === userId; }
  async claim(userId: string, jobId: string) { this.owners.set(jobId, userId); }
  async addUsage() { return true; }
}

const origin = process.env.FLASK_ORIGIN ?? 'http://127.0.0.1:5000';
const fixture = process.env.TRANSPORT_DOCX ?? 'tmp/transport-large.docx';
const cfg: any = {
  COOKIE_SECRET: 'transport-test-cookie-secret-at-least-32-characters',
  FLASK_ORIGIN: origin,
  REDIS_URL: 'redis://127.0.0.1:6379',
  USER_JOB_CONCURRENCY: 2,
  WORKER_CONCURRENCY: 1,
  JOB_TTL_HOURS: 1,
  PORT: 4100,
  NODE_ENV: 'test',
  UPLOAD_MAX_BYTES: 8 * 1024 * 1024,
  UPSTREAM_HEADERS_TIMEOUT_MS: 10_000,
  UPSTREAM_BODY_TIMEOUT_MS: 120_000,
  RATE_LIMIT_MAX: 600,
};

const app = await buildApp(new TransportStore(), cfg);
await app.listen({ host: '127.0.0.1', port: 4100 });

const headers = { cookie: 'session=transport-session', 'content-type': 'application/json' };
const assertOk = async (label: string, response: Response) => {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${text.slice(0, 500)}`);
  return text;
};

try {
  const ready = await fetch('http://127.0.0.1:4100/healthz');
  const readyText = await assertOk('gateway readiness', ready);
  if (!readyText.includes('"processor":"ready"')) throw new Error(`processor not ready: ${readyText}`);

  const rewrite = await fetch('http://127.0.0.1:4100/api/text/rewrite', {
    method: 'POST', headers,
    body: JSON.stringify({
      text: 'It is important to note that the proposed system is capable of providing an explanation of the decision.',
      profile: 'rewrite_compress',
    }),
  });
  const rewriteText = await assertOk('text rewrite', rewrite);
  const rewriteJson = JSON.parse(rewriteText);
  if (rewriteJson.ok !== true || typeof rewriteJson.rewritten_text !== 'string') throw new Error(`unexpected rewrite response: ${rewriteText.slice(0, 500)}`);

  const detection = await fetch('http://127.0.0.1:4100/api/detection/text', {
    method: 'POST', headers,
    body: JSON.stringify({ text: 'This is a direct gateway to Flask processor transport test with enough text to exercise the diagnostic endpoint.' }),
  });
  const detectionText = await assertOk('text detection', detection);
  const detectionJson = JSON.parse(detectionText);
  if (detectionJson.ok !== true || !detectionJson.report) throw new Error(`unexpected detection response: ${detectionText.slice(0, 500)}`);

  const bytes = await readFile(fixture);
  if (bytes.length <= 2 * 1024 * 1024) throw new Error(`large DOCX fixture is only ${bytes.length} bytes`);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.set('docx_file', new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'transport-large.docx');
  form.set('max_words', '4500');
  const upload = await fetch('http://127.0.0.1:4100/api/documents/upload', {
    method: 'POST',
    headers: { cookie: 'session=transport-session' },
    body: form,
  });
  const uploadText = await assertOk('large DOCX upload', upload);
  const uploadJson = JSON.parse(uploadText);
  if (uploadJson.representation !== 'legacy-html' || !String(uploadJson.html).includes('Select content to rewrite')) {
    throw new Error(`unexpected upload response: ${uploadText.slice(0, 500)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    processor: origin,
    rewriteStatus: rewrite.status,
    detectionStatus: detection.status,
    uploadStatus: upload.status,
    uploadedBytes: bytes.length,
  }));
} finally {
  await app.close();
}
