import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';

export const documentRoutes = [
  { method: 'POST', url: '/api/documents/upload', upstream: '/internal/v1/documents', multipart: { field: 'docx_file', extensions: ['.docx'] } },
  { method: 'GET', url: '/api/documents/jobs/:jobId', upstream: (r: any) => `/internal/v1/documents/${r.params.jobId}` },
] as const;
export const registerDocumentAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [...documentRoutes]);
