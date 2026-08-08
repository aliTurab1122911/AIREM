import { rangeContinueSchema, rangeDraftSchema, rangeExportSchema, rangesSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerRangeAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/ranges/:jobId/extract', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/extract`, bodySchema: rangesSchema },
  { method: 'GET', url: '/api/ranges/:jobId/chunks', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/chunks` },
  { method: 'POST', url: '/api/ranges/:jobId/draft', upstream: (r: any) => `/api/range-edit/${r.params.jobId}/draft`, bodySchema: rangeDraftSchema },
  { method: 'POST', url: '/api/ranges/:jobId/export', upstream: (r: any) => `/api/range-edit/${r.params.jobId}/export`, bodySchema: rangeExportSchema },
  { method: 'POST', url: '/api/ranges/:jobId/continue', upstream: (r: any) => `/api/range-edit/${r.params.jobId}/continue`, bodySchema: rangeContinueSchema },
]);
