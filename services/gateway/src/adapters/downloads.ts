import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerDownloadAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'GET', url: '/api/documents/preview/:jobId/*', upstream: r => `/preview/${(r.params as any).jobId}/${(r.params as any)['*']}` },
  { method: 'GET', url: '/api/documents/download/:jobId/*', upstream: r => `/download/${(r.params as any).jobId}/${(r.params as any)['*']}` },
]);
