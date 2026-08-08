import type { FastifyInstance } from 'fastify';
import type { AdapterHandler } from './types.js';

/**
 * PR10 cutover: the former /api/openai/ranges/:jobId/draft compatibility alias
 * is intentionally no longer registered. OpenAI and manual range sessions both
 * use the canonical /api/ranges/:jobId/draft route.
 *
 * Keep this no-op export for one release so downstream imports fail softly;
 * the route itself is gone from the public application.
 */
export const registerOpenAiRangeEditAdapter = (_app: FastifyInstance, _handler: AdapterHandler) => undefined;
