import { rewriteRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerRewriteAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'GET', url: '/api/rewrite/profiles', upstream: '/rewrite/profiles' },
  { method: 'POST', url: '/api/rewrite/:jobId', upstream: (r: any) => `/rewrite/${r.params.jobId}`, bodySchema: rewriteRequestSchema },
  { method: 'POST', url: '/api/rewrite/:jobId/cycles', upstream: (r: any) => `/rewrite-cycle/${r.params.jobId}`, bodySchema: rewriteRequestSchema },
]);
