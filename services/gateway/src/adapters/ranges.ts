import {
  rangeEditActionRequestSchema,
  rangeEditDraftRequestSchema,
  rangeSelectionRequestSchema,
} from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';

export const registerRangeAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/ranges/:jobId/extract', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/extract`, bodySchema: rangeSelectionRequestSchema },
  { method: 'GET', url: '/api/ranges/:jobId/chunks', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/chunks` },
  { method: 'GET', url: '/api/ranges/configuration', upstream: '/internal/v1/range-edit/configuration' },
  { method: 'POST', url: '/api/ranges/:jobId/draft', upstream: (r: any) => `/internal/v1/range-edit/${r.params.jobId}/draft`, bodySchema: rangeEditDraftRequestSchema },
  { method: 'POST', url: '/api/ranges/:jobId/export', upstream: (r: any) => `/internal/v1/range-edit/${r.params.jobId}/export`, bodySchema: rangeEditActionRequestSchema },
  { method: 'POST', url: '/api/ranges/:jobId/continue', upstream: (r: any) => `/internal/v1/range-edit/${r.params.jobId}/continue`, bodySchema: rangeEditActionRequestSchema },
]);
