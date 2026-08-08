import {
  formattingApplyRequestSchema,
  rewriteRequestSchema,
  textDetectionRequestSchema,
  textRewriteRequestSchema,
  validationRequestSchema,
} from '@airem/contracts';
import { z } from 'zod';
import type { UsageKind } from './usage.js';

export const queuedOperationSchema = z.enum([
  'text_rewrite',
  'text_detection',
  'document_rewrite',
  'document_validation',
  'formatting_apply',
]);
export type QueuedOperation = z.infer<typeof queuedOperationSchema>;

const sourceJobSchema = z.object({ source_job_id: z.string().uuid() }).passthrough();

export type QueuedProcessorCall = {
  operation: QueuedOperation;
  sourceJobId?: string;
  path: string;
  body: Record<string, unknown>;
  usageKind?: UsageKind;
};

function validate<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } }, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw Object.assign(new Error(message), { code: 'VALIDATION_ERROR', validation: parsed.error });
  return parsed.data;
}

function withSource(payload: unknown) {
  const source = validate(sourceJobSchema, payload, 'source_job_id is required and must be a UUID');
  const { source_job_id, ...body } = source as Record<string, unknown> & { source_job_id: string };
  return { sourceJobId: source_job_id, body };
}

/** Resolve one queued request to the same structured processor route used by the synchronous gateway. */
export function queuedProcessorCall(operationValue: unknown, payload: unknown): QueuedProcessorCall {
  const operation = validate(queuedOperationSchema, operationValue, 'Unsupported queued operation');
  if (operation === 'text_rewrite') {
    const body = validate(textRewriteRequestSchema, payload, 'Invalid text rewrite payload');
    return { operation, path: '/internal/v1/text/rewrite', body: body as Record<string, unknown>, usageKind: 'text_rewrite' };
  }
  if (operation === 'text_detection') {
    const body = validate(textDetectionRequestSchema, payload, 'Invalid text detection payload');
    return { operation, path: '/internal/v1/detection/text', body: body as Record<string, unknown>, usageKind: 'detection' };
  }

  const { sourceJobId, body: sourceBody } = withSource(payload);
  if (operation === 'document_rewrite') {
    const body = validate(rewriteRequestSchema, sourceBody, 'Invalid document rewrite payload');
    return { operation, sourceJobId, path: `/internal/v1/rewrite-jobs/${sourceJobId}/rewrite`, body: body as Record<string, unknown>, usageKind: 'document_rewrite' };
  }
  if (operation === 'document_validation') {
    const body = validate(validationRequestSchema, sourceBody, 'Invalid document validation payload');
    return { operation, sourceJobId, path: `/internal/v1/rewrite-jobs/${sourceJobId}/validate`, body: body as Record<string, unknown> };
  }
  const body = validate(formattingApplyRequestSchema, sourceBody, 'Invalid formatting payload');
  return { operation, sourceJobId, path: `/internal/v1/formatting/${sourceJobId}/apply`, body: body as Record<string, unknown> };
}
