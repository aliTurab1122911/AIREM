import { readFile } from 'node:fs/promises';
import {
  documentUploadResponseSchema,
  extractionResponseSchema,
  rangeSelectionRequestSchema,
} from '@airem/contracts';
import { buildApp } from '../src/app.js';
import type { GatewayStore } from '../src/store.js';

class SelectionStore implements GatewayStore {
  private readonly owners = new Map<string, string>();
  async sessionUser(session: string) { return session === 'selection-session' ? 'selection-user' : undefined; }
  async owns(userId: string, jobId: string) { return this.owners.get(jobId) === userId; }
  async claim(userId: string, jobId: string) { this.owners.set(jobId, userId); }
  async addUsage() { return true; }
}

const origin = process.env.FLASK_ORIGIN ?? 'http://127.0.0.1:5000';
const fixture = process.env.SELECTION_DOCX ?? 'docs/sample_1_org.docx';
const cfg: any = {
  COOKIE_SECRET: 'selection-test-cookie-secret-at-least-32-characters',
  FLASK_ORIGIN: origin,
  REDIS_URL: 'redis://127.0.0.1:6379',
  USER_JOB_CONCURRENCY: 2,
  WORKER_CONCURRENCY: 1,
  JOB_TTL_HOURS: 1,
  PORT: 4102,
  NODE_ENV: 'test',
  UPLOAD_MAX_BYTES: 8 * 1024 * 1024,
  UPSTREAM_HEADERS_TIMEOUT_MS: 10_000,
  UPSTREAM_BODY_TIMEOUT_MS: 120_000,
  RATE_LIMIT_MAX: 600,
};

const app = await buildApp(new SelectionStore(), cfg);
await app.listen({ host: '127.0.0.1', port: 4102 });
const base = 'http://127.0.0.1:4102';
const cookie = { cookie: 'session=selection-session' };
const bytes = await readFile(fixture);

const json = async (label: string, response: Response) => {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}: ${response.status} ${text.slice(0, 600)}`);
  return JSON.parse(text);
};

const upload = async () => {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.set('docx_file', new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'selection.docx');
  const response = await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: cookie, body: form });
  return documentUploadResponseSchema.parse(await json('upload', response));
};

const extract = async (jobId: string, payload: unknown) => {
  const validated = rangeSelectionRequestSchema.parse(payload);
  const response = await fetch(`${base}/api/ranges/${jobId}/extract`, {
    method: 'POST',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify(validated),
  });
  return extractionResponseSchema.parse(await json('extract', response));
};

try {
  const ready = await fetch(`${base}/healthz`);
  if (!ready.ok) throw new Error(`gateway not ready: ${ready.status}`);

  const automaticUpload = await upload();
  if (!automaticUpload.inventory.blocks.length || !automaticUpload.inventory.visual_elements.length) throw new Error('inventory is empty');
  const automatic = await extract(automaticUpload.job_id, { selection_mode: 'automatic' });
  if (!automatic.chunks.length) throw new Error('automatic selection returned no chunks');

  const immutableRetry = await fetch(`${base}/api/ranges/${automaticUpload.job_id}/extract`, {
    method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body: JSON.stringify({ selection_mode: 'automatic' }),
  });
  if (immutableRetry.status !== 409) throw new Error(`expected immutable extraction 409, got ${immutableRetry.status}`);

  const manualUpload = await upload();
  const manualBlock = manualUpload.inventory.blocks.find(block => block.default_selected);
  if (!manualBlock) throw new Error('no default-selected block in fixture');
  const manual = await extract(manualUpload.job_id, { selection_mode: 'manual', selected_blocks: [manualBlock.block_id] });
  const manualSelection = manual.mapping.selection as { selected_block_ids?: string[] };
  if (!manualSelection.selected_block_ids?.includes(manualBlock.block_id)) throw new Error('manual block ID was lost');

  const rangeUpload = await upload();
  const rangeBlock = rangeUpload.inventory.blocks.find(block => block.default_selected);
  if (!rangeBlock) throw new Error('no range block in fixture');
  const ranged = await extract(rangeUpload.job_id, { selection_mode: 'range', start_order: rangeBlock.order, end_order: rangeBlock.order });
  const rangeSelection = ranged.mapping.selection as { selected_block_ids?: string[] };
  if (!rangeSelection.selected_block_ids?.includes(rangeBlock.block_id)) throw new Error('ordered range did not preserve selected block');

  const visualUpload = await upload();
  const visual = visualUpload.inventory.visual_elements.find(element => element.text.trim().length >= 16);
  if (!visual) throw new Error('no visual element with text');
  const start = visual.text.search(/\S/);
  const end = Math.min(visual.text.length, start + 16);
  const exact = await extract(visualUpload.job_id, {
    selection_mode: 'visual',
    visual_ranges: [{
      start_id: visual.visual_id, start_offset: start,
      end_id: visual.visual_id, end_offset: end,
      source: 'manual', preview: visual.text.slice(start, end),
    }],
  });
  const visualSelection = exact.mapping.selection as { visual_ranges?: Array<{ start_id: string; start_offset: number; end_offset: number }> };
  const saved = visualSelection.visual_ranges?.[0];
  if (!saved || saved.start_id !== visual.visual_id || saved.start_offset !== start || saved.end_offset !== end) throw new Error('exact visual coordinates changed in transit');

  console.log(JSON.stringify({
    ok: true,
    blocks: automaticUpload.inventory.block_count,
    visualElements: automaticUpload.inventory.visual_element_count,
    automaticChunks: automatic.chunks.length,
    manualBlock: manualBlock.block_id,
    rangeBlock: rangeBlock.block_id,
    visualId: visual.visual_id,
    visualOffsets: [start, end],
  }));
} finally {
  await app.close();
}
