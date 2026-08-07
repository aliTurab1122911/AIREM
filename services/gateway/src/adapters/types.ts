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
  for (const route of routes) app.route({ method: route.method, url: route.url, handler: handler(route) as never });
}
