import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';

export const documentRoutes = [
  { method: 'POST', url: '/api/documents/upload', upstream: '/upload', multipart: { field: 'docx_file', extensions: ['.docx'] }, html: 'json' },
  { method: 'GET', url: '/api/documents/jobs/:jobId', upstream: (r: any) => `/job/${r.params.jobId}`, html: 'json' },
] as const;
export const registerDocumentAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [...documentRoutes]);
