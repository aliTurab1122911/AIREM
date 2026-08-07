import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { Config } from './config.js';
import type { GatewayStore } from './store.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EXTENSIONS = new Set(['.docx', '.pdf']);
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODYLESS = new Set(['GET', 'HEAD']);
const RESPONSE_METADATA_LIMIT = 2 * 1024 * 1024;

type UpstreamResponse = { statusCode: number; headers: Record<string, string | string[] | undefined>; body: NodeJS.ReadableStream };
export type Upstream = (args: { method: string; path: string; headers: Record<string, string | string[] | undefined>; body?: NodeJS.ReadableStream }) => Promise<UpstreamResponse>;

function targetPath(url: string) {
  const [pathname, query] = url.split('?', 2);
  const rules: [RegExp, string][] = [
    [/^\/api\/documents\/upload$/, '/upload'], [/^\/api\/documents\/jobs\//, '/job/'],
    [/^\/api\/documents\/preview\//, '/preview/'], [/^\/api\/documents\/download\//, '/download/'],
    [/^\/api\/rewrite\//, '/rewrite/'], [/^\/api\/detection\/text$/, '/api/detect-text'],
    [/^\/api\/detection\/file$/, '/api/detect-file'], [/^\/api\/formatting\/analyse$/, '/formatting/analyse'],
    [/^\/api\/formatting\/apply\//, '/formatting/apply/'],
  ];
  const mapped = rules.reduce((value, [pattern, replacement]) => pattern.test(value) ? value.replace(pattern, replacement) : value, pathname);
  return query ? `${mapped}?${query}` : mapped;
}

function uploadExtension(contentDisposition: string) {
  const match = /filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i.exec(contentDisposition);
  if (!match) return undefined;
  const filename = decodeURIComponent(match[1].replace(/"$/, '')).toLowerCase();
  return [...EXTENSIONS].find(extension => filename.endsWith(extension));
}

async function validateMultipart(payload: NodeJS.ReadableStream, headerDisposition: string) {
  const iterator = (payload as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  const buffered: Buffer[] = []; let inspected = ''; let inspectedBytes = 0; let extension = uploadExtension(headerDisposition);
  while (!extension && inspectedBytes < 256 * 1024) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = Buffer.from(next.value); buffered.push(chunk); inspectedBytes += chunk.length;
    inspected += chunk.toString('latin1');
    const filename = /filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i.exec(inspected)?.[0] ?? '';
    extension = uploadExtension(filename);
    if (/filename\*?=/i.test(inspected) && !extension) throw Object.assign(new Error('unsupported upload extension'), { statusCode: 415 });
    if (inspected.length > 4096) inspected = inspected.slice(-4096);
  }
  if (!extension) throw Object.assign(new Error('multipart upload filename missing'), { statusCode: 415 });
  async function* replay() { for (const chunk of buffered) yield chunk; for await (const chunk of { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<Buffer>) yield chunk; }
  return Readable.from(replay());
}

function cleanHeaders(headers: FastifyRequest['headers'], requestId: string) {
  const result: Record<string, string | string[] | undefined> = { ...headers, 'x-request-id': requestId };
  for (const name of ['host', 'cookie', 'authorization', 'content-length', 'connection', 'transfer-encoding']) delete result[name];
  return result;
}

export function buildApp(store: GatewayStore, cfg: Config, upstream?: Upstream) {
  const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body', 'res.body'] }, disableRequestLogging: true, bodyLimit: cfg.UPLOAD_MAX_BYTES, requestIdHeader: false, genReqId: () => randomUUID() });
  app.register(cookie, { secret: cfg.COOKIE_SECRET });
  app.register(rateLimit, { global: false });
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
  const dispatch: Upstream = upstream ?? (async args => {
    const response = await undiciRequest(new URL(args.path, cfg.FLASK_ORIGIN), {
      method: args.method as Dispatcher.HttpMethod, headers: args.headers, body: args.body as Readable | undefined,
      headersTimeout: cfg.UPSTREAM_HEADERS_TIMEOUT_MS, bodyTimeout: cfg.UPSTREAM_BODY_TIMEOUT_MS,
    });
    return response as unknown as UpstreamResponse;
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: { name: error.name, message: error.message }, requestId: request.id }, 'gateway request rejected');
    const status = (error as { statusCode?: number }).statusCode ?? 502;
    return reply.status(status).send({ error: { code: status === 413 ? 'UPLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'GATEWAY_ERROR' }, requestId: request.id });
  });

  const handler = async (request: FastifyRequest, reply: any) => {
    const session = request.cookies.session;
    const userId = session && await store.sessionUser(session);
    if (!userId) return reply.status(401).send({ error: { code: 'AUTH_REQUIRED' }, requestId: request.id });

    const jobId = request.url.match(UUID)?.[0]?.toLowerCase();
    if (jobId && !await store.owns(userId, jobId)) return reply.status(404).send({ error: { code: 'JOB_NOT_FOUND' }, requestId: request.id });

    const contentType = request.headers['content-type'] ?? '';
    let requestBody = request.body as NodeJS.ReadableStream;
    if (contentType.startsWith('multipart/form-data')) {
      const length = Number(request.headers['content-length'] ?? 0);
      if (length && length > cfg.UPLOAD_MAX_BYTES) return reply.status(413).send({ error: { code: 'UPLOAD_TOO_LARGE' }, requestId: request.id });
      try { requestBody = await validateMultipart(requestBody, String(request.headers['content-disposition'] ?? '')); }
      catch { return reply.status(415).send({ error: { code: 'UNSUPPORTED_FILE_TYPE' }, requestId: request.id }); }
    }

    const started = Date.now();
    const response = await dispatch({ method: request.method, path: targetPath(request.url), headers: cleanHeaders(request.headers, request.id), body: BODYLESS.has(request.method) ? undefined : requestBody });
    const responseType = String(response.headers['content-type'] ?? '');
    const isDownload = responseType.includes('application/pdf') || responseType.includes('officedocument') || String(response.headers['content-disposition'] ?? '').includes('attachment');
    const responseHeaders = { ...response.headers, 'x-request-id': request.id };
    delete responseHeaders['connection']; delete responseHeaders['transfer-encoding'];
    reply.code(response.statusCode).headers(responseHeaders);

    if (isDownload) {
      request.log.info({ requestId: request.id, userId, method: request.method, path: request.routeOptions.url, statusCode: response.statusCode, durationMs: Date.now() - started }, 'gateway access');
      return reply.send(response.body); // stream, never materialise document bytes
    }

    const chunks: Buffer[] = []; let size = 0;
    for await (const raw of response.body as AsyncIterable<Buffer>) { const chunk = Buffer.from(raw); size += chunk.length; if (size > RESPONSE_METADATA_LIMIT) throw Object.assign(new Error('upstream metadata too large'), { statusCode: 502 }); chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      const discovered = body.toString('utf8').match(UUID)?.[0]?.toLowerCase() ?? String(response.headers.location ?? '').match(UUID)?.[0]?.toLowerCase();
      if (!jobId && discovered) await store.claim(userId, discovered);
      if (MUTATIONS.has(request.method)) {
        const words = Number(response.headers['x-airem-words-processed'] ?? 0);
        if (words > 0 && !await store.addUsage(userId, words)) return reply.status(403).send({ error: { code: 'WORD_ALLOWANCE_EXCEEDED' }, requestId: request.id });
      }
    }
    request.log.info({ requestId: request.id, userId, method: request.method, path: request.routeOptions.url, statusCode: response.statusCode, durationMs: Date.now() - started }, 'gateway access');
    return reply.send(body);
  };

  const options = { config: { rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: '1 minute' } }, handler };
  app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/documents/*', ...options });
  app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/rewrite/*', ...options });
  app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/detection/*', ...options });
  app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/formatting/*', ...options });
  for (const url of ['/job/*', '/preview/*', '/download/*', '/rewrite/*', '/formatting/*']) app.route({ method: ['GET', 'HEAD', 'POST'], url, ...options });
  app.get('/healthz', async () => ({ ok: true }));
  return app;
}
