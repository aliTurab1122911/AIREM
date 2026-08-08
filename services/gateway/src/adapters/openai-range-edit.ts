import { rangeEditDraftRequestSchema } from '@airem/contracts';
import type { FastifyInstance } from 'fastify';
import { registerAdapter, type AdapterHandler } from './types.js';

export const registerOpenAiRangeEditAdapter = (app: FastifyInstance, handler: AdapterHandler) => registerAdapter(app, handler, [
  {
    method: 'POST',
    url: '/api/openai/ranges/:jobId/draft',
    upstream: (r: any) => `/internal/v1/range-edit/${r.params.jobId}/draft`,
    bodySchema: rangeEditDraftRequestSchema,
  },
]);
