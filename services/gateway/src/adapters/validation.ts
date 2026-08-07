import { reinsertionRequestSchema, validationRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerValidationAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/validation/:jobId', upstream: (r: any) => `/validate/${r.params.jobId}`, bodySchema: validationRequestSchema },
  { method: 'POST', url: '/api/reinsertion/:jobId', upstream: (r: any) => `/reinsert/${r.params.jobId}`, bodySchema: reinsertionRequestSchema },
]);
