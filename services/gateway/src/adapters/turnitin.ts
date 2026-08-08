import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';

export const registerTurnitinAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/turnitin/:jobId', upstream: (r: any) => `/internal/v1/turnitin/${r.params.jobId}`, multipart: { field: 'turnitin_pdf', extensions: ['.pdf'] } },
]);
