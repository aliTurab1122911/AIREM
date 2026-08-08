import { textDetectionRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerDetectionAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/detection/text', upstream: '/internal/v1/detection/text', bodySchema: textDetectionRequestSchema },
  { method: 'POST', url: '/api/detection/file', upstream: '/internal/v1/detection/file', multipart: { field: 'file', extensions: ['.docx', '.txt'] } },
]);
