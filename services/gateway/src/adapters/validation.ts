import { reinsertionRequestSchema, validationRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerValidationAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/validation/:jobId', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/validate`, bodySchema: validationRequestSchema },
  { method: 'POST', url: '/api/reinsertion/:jobId', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/reinsert`, bodySchema: reinsertionRequestSchema },
]);
