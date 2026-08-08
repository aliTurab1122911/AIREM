import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { Config } from './config.js';
import { IdempotencyConflictError, type GatewayStore } from './store.js';
import type { JobQueue } from './jobs.js';
import { queuedProcessorCall } from './orchestration.js';
import { usageWords } from './usage.js';
import {
  registerDetectionAdapter, registerDocumentAdapter, registerDownloadAdapter,
  registerFormattingAdapter, registerOpenAiRangeEditAdapter, registerRangeAdapter,
  registerRewriteAdapter, registerTextRewriteAdapter, registerValidationAdapter,
  type AdapterRoute,
} from './adapters/index.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const BODYLESS = new Set(['GET', 'HEAD']);
const RESPONSE_METADATA_LIMIT = 2 * 1024 * 1024;

type ForwardBody = NodeJS.ReadableStream | Buffer | string;
type UpstreamResponse = { statusCode: number; headers: Record<string, string | string[] | undefined>; body: NodeJS.ReadableStream };
export type Upstream = (args: { method: string; path: string; headers: Record<string, string | string[] | undefined>; body?: ForwardBody }) => Promise<UpstreamResponse>;

function uploadExtension(contentDisposition: string, extensions: readonly string[]) {
  const match = /filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i.exec(contentDisposition);
  if (!match) return undefined;
  let filename: string;
  try { filename = decodeURIComponent(match[1].replace(/"$/, '')).toLowerCase(); }
  catch { filename = match[1].replace(/"$/, '').toLowerCase(); }
  return extensions.find(extension => filename.endsWith(extension));
}

async function validateMultipart(payload: NodeJS.ReadableStream, field: string, extensions: readonly string[]) {
  const iterator = (payload as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  const buffered: Buffer[] = [];
  let headerWindow = '';
  let inspectedBytes = 0;
  let fieldSeen = false;
  let filenameSeen = false;
  let extension: string | undefined;
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldPattern = new RegExp(`name="${escapedField}"`, 'i');

  while ((!fieldSeen || !filenameSeen || !extension) && inspectedBytes < 256 * 1024) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = Buffer.from(next.value);
    buffered.push(chunk);
    inspectedBytes += chunk.length;
    headerWindow += chunk.toString('latin1');

    if (!fieldSeen && fieldPattern.test(headerWindow)) fieldSeen = true;
    if (!filenameSeen) {
      const disposition = /Content-Disposition:[^\r\n]*filename\*?=(?:UTF-8''|"?)[^;\r\n]+/i.exec(headerWindow)?.[0];
      if (disposition) {
        filenameSeen = true;
        extension = uploadExtension(disposition, extensions);
        if (!extension) throw Object.assign(new Error('unsupported upload extension'), { statusCode: 415 });
      }
    }
    if (headerWindow.length > 16 * 1024) headerWindow = headerWindow.slice(-16 * 1024);
  }

  if (!fieldSeen || !filenameSeen) throw Object.assign(new Error('multipart upload field missing'), { statusCode: 400 });
  if (!extension) throw Object.assign(new Error('unsupported upload extension'), { statusCode: 415 });

  async function* replay() {
    for (const chunk of buffered) yield chunk;
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<Buffer>) yield chunk;
  }
  return Readable.from(replay());
}

function cleanHeaders(headers: FastifyRequest['headers'], requestId: string) {
  const result: Record<string, string | string[] | undefined> = { ...headers, 'x-request-id': requestId };
  for (const name of ['host', 'cookie', 'authorization', 'content-length', 'connection', 'transfer-encoding']) delete result[name];
  return result;
}

function upstreamFailureClass(error: unknown) {
  const failure = error as { name?: string; code?: string; message?: string };
  const code = String(failure.code ?? '').toUpperCase();
  const name = String(failure.name ?? 'Error');
  if (code.includes('TIMEOUT') || name.toLowerCase().includes('timeout')) return 'timeout';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET'].includes(code)) return 'connectivity';
  return 'transport';
}

export async function buildApp(store: GatewayStore, cfg: Config, upstream?: Upstream, queue?: JobQueue) {
  const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body', 'res.body'] }, disableRequestLogging: true, bodyLimit: cfg.UPLOAD_MAX_BYTES, requestIdHeader: false, genReqId: () => randomUUID() });
  await app.register(cookie, { secret: cfg.COOKIE_SECRET });
  const expensiveRateLimit = Math.max(1, Math.floor(cfg.RATE_LIMIT_MAX / 6));
  await app.register(rateLimit, { global: true, max: cfg.RATE_LIMIT_MAX, timeWindow: '1 minute' });
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
  const dispatch: Upstream = upstream ?? (async args => {
    const response = await undiciRequest(new URL(args.path, cfg.FLASK_ORIGIN), {
      method: args.method as Dispatcher.HttpMethod,
      headers: args.headers,
      body: args.body as any,
      headersTimeout: cfg.UPSTREAM_HEADERS_TIMEOUT_MS,
      bodyTimeout: cfg.UPSTREAM_BODY_TIMEOUT_MS,
    });
    return response as unknown as UpstreamResponse;
  });

  const authenticate=async(request:FastifyRequest,reply:any)=>{const session=request.cookies.session;const userId=session&&await store.sessionUser(session);if(!userId){reply.status(401).send({error:{code:'AUTH_REQUIRED'},requestId:request.id});return;}return userId;};
  const readJson=async(request:FastifyRequest)=>{const chunks:Buffer[]=[];for await(const chunk of request.body as AsyncIterable<Buffer>)chunks.push(Buffer.from(chunk));return JSON.parse(Buffer.concat(chunks).toString('utf8'));};

  app.post('/api/jobs',{config:{rateLimit:{max:expensiveRateLimit,timeWindow:'1 minute'}}},async(request,reply)=>{
    const userId=await authenticate(request,reply);if(!userId)return;
    const key=request.headers['idempotency-key'];
    if(typeof key!=='string'||key.length<8||key.length>200)return reply.status(400).send({error:{code:'IDEMPOTENCY_KEY_REQUIRED'},requestId:request.id});
    let body:any;try{body=await readJson(request);}catch{return reply.status(400).send({error:{code:'INVALID_JSON'},requestId:request.id});}
    let call;try{call=queuedProcessorCall(body?.operation,body?.payload);}catch{return reply.status(422).send({error:{code:'VALIDATION_ERROR'},requestId:request.id});}
    if(call.sourceJobId&&!await store.owns(userId,call.sourceJobId))return reply.status(404).send({error:{code:'JOB_NOT_FOUND'},requestId:request.id});
    if(!store.createJob||!queue||!await queue.isReady())return reply.status(503).send({error:{code:'QUEUE_UNAVAILABLE'},requestId:request.id});
    let made;
    try{made=await store.createJob(userId,key,call.operation,body.payload,cfg.USER_JOB_CONCURRENCY,cfg.JOB_TTL_HOURS);}
    catch(error){if(error instanceof IdempotencyConflictError)return reply.status(409).send({error:{code:error.code,message:error.message},requestId:request.id});throw error;}
    if(!made)return reply.status(429).send({error:{code:'USER_CONCURRENCY_LIMIT'},requestId:request.id});
    if(made.created){
      try{await queue.add(made.job.id);}
      catch{await store.markEnqueueFailed?.(userId,made.job.id);return reply.status(503).send({error:{code:'QUEUE_ENQUEUE_FAILED'},requestId:request.id});}
    }
    return reply.status(made.created?202:200).send({job:made.job,idempotentReplay:!made.created});
  });
  app.get('/api/jobs',async(request,reply)=>{const userId=await authenticate(request,reply);if(!userId)return;return{jobs:await store.listJobs?.(userId)??[]};});
  app.get('/api/jobs/:id',async(request,reply)=>{const userId=await authenticate(request,reply);if(!userId)return;const id=(request.params as any).id;const job=await store.getJob?.(userId,id);return job?{job}:reply.status(404).send({error:{code:'JOB_NOT_FOUND'},requestId:request.id});});
  app.delete('/api/jobs/:id',async(request,reply)=>{
    const userId=await authenticate(request,reply);if(!userId)return;const id=(request.params as any).id;
    if(!store.requestCancellation)return reply.status(503).send({error:{code:'QUEUE_UNAVAILABLE'},requestId:request.id});
    const outcome=await store.requestCancellation(userId,id);
    if(outcome==='missing')return reply.status(404).send({error:{code:'JOB_NOT_FOUND'},requestId:request.id});
    if(outcome==='terminal')return reply.status(409).send({error:{code:'JOB_ALREADY_FINISHED'},requestId:request.id});
    try{await queue?.cancel(id);}catch{/* database cancellation remains authoritative */}
    return reply.status(202).send({ok:true,cancellation:outcome});
  });
  app.get('/api/jobs/:id/events',async(request,reply)=>{
    const userId=await authenticate(request,reply);if(!userId)return;const id=(request.params as any).id;
    if(!await store.getJob?.(userId,id))return reply.status(404).send({error:{code:'JOB_NOT_FOUND'},requestId:request.id});
    reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','connection':'keep-alive'});reply.raw.write('retry: 1000\n\n');
    let previous='';
    for(let i=0;i<20&&!reply.raw.destroyed;i++){
      const job=await store.getJob?.(userId,id);const data=JSON.stringify(job);
      if(data!==previous){reply.raw.write(`id: ${job?.updatedAt??i}\nevent: progress\ndata: ${data}\n\n`);previous=data;}
      if(!job||['completed','failed','expired','review_required'].includes(job.state))break;
      await new Promise(r=>setTimeout(r,1000));
    }
    reply.raw.end();
  });

  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { statusCode?: number };
    request.log.warn({ err: { name: failure.name, message: failure.message }, requestId: request.id }, 'gateway request rejected');
    const status = failure.statusCode ?? 502;
    return reply.status(status).send({ error: { code: status === 413 ? 'UPLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'GATEWAY_ERROR' }, requestId: request.id });
  });

  const handler = Object.assign((route: AdapterRoute) => async (request: FastifyRequest, reply: any) => {
    const session = request.cookies.session;
    const userId = session && await store.sessionUser(session);
    if (!userId) return reply.status(401).send({ error: { code: 'AUTH_REQUIRED' }, requestId: request.id });

    const jobId = request.url.match(UUID)?.[0]?.toLowerCase();
    if (jobId && !await store.owns(userId, jobId)) return reply.status(404).send({ error: { code: 'JOB_NOT_FOUND' }, requestId: request.id });

    const contentType = request.headers['content-type'] ?? '';
    let requestBody: ForwardBody = request.body as NodeJS.ReadableStream;
    if (contentType.startsWith('multipart/form-data')) {
      const length = Number(request.headers['content-length'] ?? 0);
      if (length && length > cfg.UPLOAD_MAX_BYTES) return reply.status(413).send({ error: { code: 'UPLOAD_TOO_LARGE' }, requestId: request.id });
      if (!route.multipart) return reply.status(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' }, requestId: request.id });
      try { requestBody = await validateMultipart(requestBody as NodeJS.ReadableStream, route.multipart.field, route.multipart.extensions); }
      catch (error) { const status = (error as { statusCode?: number }).statusCode ?? 415; return reply.status(status).send({ error: { code: status === 400 ? 'VALIDATION_ERROR' : 'UNSUPPORTED_FILE_TYPE' }, requestId: request.id }); }
    } else if (route.bodySchema && !BODYLESS.has(request.method)) {
      if (!contentType.includes('application/json')) return reply.status(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' }, requestId: request.id });
      const chunks: Buffer[] = []; for await (const chunk of requestBody as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply.status(400).send({ error: { code: 'INVALID_JSON' }, requestId: request.id }); }
      const parsed = route.bodySchema.safeParse(value);
      if (!parsed.success) return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }, requestId: request.id });
      requestBody = Buffer.from(route.encode ? route.encode(parsed.data) : JSON.stringify(parsed.data), 'utf8');
    }

    const started = Date.now();
    const upstreamPath = typeof route.upstream === 'function' ? route.upstream(request) : route.upstream;
    const query = request.url.includes('?') ? `?${request.url.split('?', 2)[1]}` : '';
    const forwardedHeaders = cleanHeaders(request.headers, request.id);
    if (route.encode) forwardedHeaders['content-type'] = 'application/x-www-form-urlencoded';
    if (Buffer.isBuffer(requestBody) || typeof requestBody === 'string') forwardedHeaders['content-length'] = String(Buffer.byteLength(requestBody));

    let response: UpstreamResponse;
    try {
      response = await dispatch({ method: request.method, path: `${upstreamPath}${query}`, headers: forwardedHeaders, body: BODYLESS.has(request.method) ? undefined : requestBody });
    } catch (error) {
      const failureClass = upstreamFailureClass(error);
      const failure = error as { name?: string; code?: string };
      request.log.error({ requestId: request.id, userId, method: request.method, path: request.routeOptions.url, upstreamPath, failureClass, errorName: failure.name ?? 'Error', errorCode: failure.code ?? null, durationMs: Date.now() - started }, 'processor upstream request failed');
      const code = failureClass === 'timeout' ? 'PROCESSOR_TIMEOUT' : 'PROCESSOR_UNAVAILABLE';
      return reply.status(502).send({ error: { code }, requestId: request.id });
    }

    const responseType = String(response.headers['content-type'] ?? '');
    const isDownload = responseType.includes('application/pdf') || responseType.includes('officedocument') || String(response.headers['content-disposition'] ?? '').includes('attachment');
    const responseHeaders: Record<string, string | string[] | undefined> = { ...response.headers, 'x-request-id': request.id };
    delete responseHeaders['connection']; delete responseHeaders['transfer-encoding'];
    reply.code(response.statusCode).headers(responseHeaders);

    if (isDownload) {
      request.log.info({ requestId: request.id, userId, method: request.method, path: request.routeOptions.url, statusCode: response.statusCode, durationMs: Date.now() - started }, 'gateway access');
      return reply.send(response.body);
    }

    const chunks: Buffer[] = []; let size = 0;
    for await (const raw of response.body as AsyncIterable<Buffer>) { const chunk = Buffer.from(raw); size += chunk.length; if (size > RESPONSE_METADATA_LIMIT) throw Object.assign(new Error('upstream metadata too large'), { statusCode: 502 }); chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      const bodyText=body.toString('utf8');
      const discovered = bodyText.match(UUID)?.[0]?.toLowerCase() ?? String(response.headers.location ?? '').match(UUID)?.[0]?.toLowerCase();
      if (!jobId && discovered) await store.claim(userId, discovered);
      if(route.usageKind){
        let parsed:unknown;try{parsed=JSON.parse(bodyText);}catch{parsed=undefined;}
        const words=usageWords(route.usageKind,parsed);
        if(words>0&&!await store.addUsage(userId,words))return reply.status(403).send({error:{code:'WORD_ALLOWANCE_EXCEEDED'},requestId:request.id});
      }
    }
    request.log.info({ requestId: request.id, userId, method: request.method, path: request.routeOptions.url, statusCode: response.statusCode, durationMs: Date.now() - started }, 'gateway access');
    if (route.html === 'json' && responseType.includes('text/html')) {
      reply.removeHeader('content-type'); reply.removeHeader('content-length');
      return reply.type('application/json').send({ representation: 'legacy-html', content_type: responseType, html: body.toString('utf8') });
    }
    return reply.send(body);
  }, { expensiveRateLimit });

  registerDocumentAdapter(app, handler); registerRangeAdapter(app, handler);
  registerRewriteAdapter(app, handler); registerValidationAdapter(app, handler);
  registerTextRewriteAdapter(app, handler); registerDetectionAdapter(app, handler);
  registerFormattingAdapter(app, handler); registerDownloadAdapter(app, handler);
  registerOpenAiRangeEditAdapter(app, handler);

  app.get('/healthz', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      const response = await dispatch({ method: 'GET', path: '/healthz', headers: { 'x-request-id': randomUUID() } });
      for await (const _chunk of response.body as AsyncIterable<Buffer>) { /* drain */ }
      const processorReady=response.statusCode>=200&&response.statusCode<300;
      const workersAvailable=queue?await queue.isReady():false;
      if(!processorReady||!workersAvailable)return reply.status(503).send({ok:false,service:'airem-gateway',processor:processorReady?'ready':'not-ready',queue:{workersAvailable}});
      return {ok:true,service:'airem-gateway',processor:'ready',queue:{workersAvailable:true}};
    } catch (error) {
      app.log.warn({ failureClass: upstreamFailureClass(error) }, 'gateway readiness check failed');
      return reply.status(503).send({ ok: false, service: 'airem-gateway', processor: 'unreachable', queue: { workersAvailable: false } });
    }
  });
  return app;
}
