import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

export type AdapterRoute = {
  method: 'GET' | 'HEAD' | 'POST';
  url: string;
  upstream: string | ((request: FastifyRequest) => string);
  bodySchema?: ZodType;
  multipart?: { field: string; extensions: readonly string[] };
  html?: 'json' | 'passthrough';
  encode?: (value: any) => string;
};

export type AdapterHandler = (route: AdapterRoute) => (request: FastifyRequest, reply: unknown) => Promise<unknown>;

export function registerAdapter(app: FastifyInstance, handler: AdapterHandler, routes: AdapterRoute[]) {
  const expensiveMax = (handler as AdapterHandler & { expensiveRateLimit?: number }).expensiveRateLimit;
  for (const route of routes) app.route({
    method: route.method,
    url: route.url,
    config: route.method === 'POST' && expensiveMax ? { rateLimit: { max: expensiveMax, timeWindow: '1 minute' } } : undefined,
    handler: handler(route) as never,
  });
}
