import { formattingApplyRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerFormattingAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/formatting/analyse', upstream: '/internal/v1/formatting', multipart: { field: 'docx_file', extensions: ['.docx'] } },
  { method: 'POST', url: '/api/formatting/apply/:jobId', upstream: (r: any) => `/internal/v1/formatting/${r.params.jobId}/apply`, bodySchema: formattingApplyRequestSchema },
]);
