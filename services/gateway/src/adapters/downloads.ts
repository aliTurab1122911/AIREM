import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerDownloadAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'GET', url: '/api/documents/preview/:jobId/*', upstream: r => `/preview/${(r.params as any).jobId}/${(r.params as any)['*']}` },
  { method: 'GET', url: '/api/documents/download/:jobId/*', upstream: r => `/download/${(r.params as any).jobId}/${(r.params as any)['*']}` },
  // JSON processor responses intentionally carry Flask's canonical URLs. Keep
  // those URLs usable through the public gateway rather than rewriting payloads.
  { method: 'GET', url: '/preview/:jobId/*', upstream: r => `/preview/${(r.params as any).jobId}/${(r.params as any)['*']}` },
  { method: 'GET', url: '/download/:jobId/*', upstream: r => `/download/${(r.params as any).jobId}/${(r.params as any)['*']}` },
]);
