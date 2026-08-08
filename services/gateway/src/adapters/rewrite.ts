import { rewriteCycleRequestSchema, rewriteRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerRewriteAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'GET', url: '/api/rewrite/profiles', upstream: '/rewrite/profiles' },
  { method: 'POST', url: '/api/rewrite/:jobId', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/rewrite`, bodySchema: rewriteRequestSchema },
  { method: 'POST', url: '/api/rewrite/:jobId/cycles', upstream: (r: any) => `/internal/v1/rewrite-jobs/${r.params.jobId}/cycles`, bodySchema: rewriteCycleRequestSchema },
]);
