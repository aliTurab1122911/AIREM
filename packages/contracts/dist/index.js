import { z } from 'zod';
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const DISPLAY_NAME_MIN_LENGTH = 1;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const displayNameSchema = z.string().trim().min(DISPLAY_NAME_MIN_LENGTH).max(DISPLAY_NAME_MAX_LENGTH);
export const registrationSchema = z.object({
    displayName: displayNameSchema,
    email: z.string().email().max(320).transform(value => value.trim().toLowerCase()),
    password: passwordSchema,
});
export const jobIdSchema = z.string().uuid();
export const rangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).refine(v => v.end > v.start, 'end must be greater than start');
export const rangesSchema = z.object({ selection_mode: z.enum(['automatic', 'manual', 'range', 'visual']).default('automatic'), selected_blocks: z.array(z.string()).optional(), start_order: z.number().int().nonnegative().optional(), end_order: z.number().int().nonnegative().optional(), visual_ranges: z.array(z.record(z.string(), z.unknown())).optional(), include_headings: z.boolean().optional(), include_captions: z.boolean().optional(), include_table_headers: z.boolean().optional() }).passthrough();
export const rangeDraftSchema = z.object({ visual_ranges: z.array(z.record(z.string(), z.unknown())).min(1), manual_only: z.boolean().optional(), prompt: z.string().optional(), model: z.string().optional() }).passthrough();
export const rangeExportSchema = z.object({ session_id: z.string().min(1), replacements: z.array(z.string()).optional(), edited_texts: z.record(z.string(), z.string()).optional() }).passthrough();
export const rangeContinueSchema = rangeExportSchema;
export const rewriteRequestSchema = z.object({ profile: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional(), profile_id: z.string().min(1).optional(), intensity: z.number().min(0).max(1).optional() }).passthrough();
export const validationRequestSchema = z.object({ edited_texts: z.record(z.string(), z.string()).optional(), text: z.string().optional() }).passthrough();
export const reinsertionRequestSchema = validationRequestSchema;
export const textRewriteRequestSchema = z.object({ text: z.string().min(1), profile: z.string().optional(), intensity: z.number().min(0).max(1).optional() }).passthrough();
export const textDetectionRequestSchema = z.object({ text: z.string().min(1) }).passthrough();
export const formattingApplyRequestSchema = z.object({ settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) }).passthrough();
export const openAiRangeEditSchema = rangeDraftSchema.extend({ manual_only: z.literal(false).optional() });
export const progressStateSchema = z.enum(['queued', 'extracting', 'rewriting', 'validating', 'reinserting', 'complete', 'failed']);
export const errorResponseSchema = z.object({ error: z.object({ code: z.string(), message: z.string().optional(), issues: z.array(z.object({ path: z.string(), message: z.string() })).optional() }), requestId: z.string() });
export const jobResponseSchema = z.object({ job_id: jobIdSchema, state: progressStateSchema.optional() }).passthrough();
export const legacyHtmlResponseSchema = z.object({ representation: z.literal('legacy-html'), content_type: z.string(), html: z.string() });
