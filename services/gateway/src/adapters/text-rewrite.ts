import { textRewriteRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';
export const registerTextRewriteAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  { method: 'POST', url: '/api/text/rewrite', upstream: '/internal/v1/text/rewrite', bodySchema: textRewriteRequestSchema },
]);
