import { formattingApplyRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerFormattingAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/formatting/analyse', upstream: '/formatting/analyse', multipart: { field: 'docx_file', extensions: ['.docx'] }, html: 'json' },
  { method: 'POST', url: '/api/formatting/apply/:jobId', upstream: (r: any) => `/formatting/apply/${r.params.jobId}`, bodySchema: formattingApplyRequestSchema, encode: value => { const form = new URLSearchParams(); for (const [key, raw] of Object.entries(value.settings)) form.set(key, raw === true ? 'on' : raw === false ? '' : String(raw)); return form.toString(); }, html: 'json' },
]);
