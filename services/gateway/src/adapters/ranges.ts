import { rangeContinueSchema, rangeDraftSchema, rangeExportSchema, rangesSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerRangeAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/ranges/:jobId/extract', upstream: (r: any) => `/create-extract/${r.params.jobId}`, bodySchema: rangesSchema, encode: value => { const form = new URLSearchParams(); for (const [key, raw] of Object.entries(value)) { if (key === 'visual_ranges') form.set('visual_ranges_json', JSON.stringify(raw)); else if (Array.isArray(raw)) raw.forEach(item => form.append(key, String(item))); else if (typeof raw === 'boolean') { if (raw) form.set(key, 'on'); } else if (raw != null) form.set(key, String(raw)); } return form.toString(); }, html: 'json' },
  { method: 'POST', url: '/api/ranges/:jobId/draft', upstream: (r: any) => `/api/range-edit/${r.params.jobId}/draft`, bodySchema: rangeDraftSchema },
  { method: 'POST', url: '/api/ranges/:jobId/export', upstream: (r: any) => `/api/range-edit/${r.params.jobId}/export`, bodySchema: rangeExportSchema },
  { method: 'POST', url: '/api/ranges/:jobId/continue', upstream: (r: any) => `/api/range-edit/${r.params.jobId}/continue`, bodySchema: rangeContinueSchema, html: 'json' },
]);
