import { z } from 'zod';

export const rangeVisualRangeSchema = z.object({
  start_id: z.string().min(1),
  start_offset: z.number().int().nonnegative(),
  end_id: z.string().min(1),
  end_offset: z.number().int().nonnegative(),
  source: z.string().optional(),
  preview: z.string().optional(),
  pdf_pages: z.array(z.number().int().positive()).optional(),
  table_index: z.number().int().nonnegative().optional(),
}).passthrough();

export const turnitinAnalysisSchema = z.object({
  verification_status: z.enum(['verified', 'review', 'mismatch']),
  verification_message: z.string(),
  filename_match: z.boolean(),
  original_filename: z.string(),
  reported_filename: z.string(),
  reported_word_count: z.number().int().nonnegative().nullable(),
  reported_ai_score: z.number().min(0).max(100).nullable(),
  submission_id: z.string(),
  page_count: z.number().int().nonnegative(),
  docx_token_count: z.number().int().nonnegative(),
  report_token_count: z.number().int().nonnegative(),
  matched_token_count: z.number().int().nonnegative(),
  content_similarity: z.number().min(0).max(1),
  sequence_similarity: z.number().min(0).max(1),
  highlight_rectangle_count: z.number().int().nonnegative(),
  highlighted_page_count: z.number().int().nonnegative(),
  highlighted_report_token_count: z.number().int().nonnegative(),
  mapped_highlight_token_count: z.number().int().nonnegative(),
  highlight_mapping_coverage: z.number().min(0).max(1),
  exact_ranges: z.array(rangeVisualRangeSchema),
  exact_range_count: z.number().int().nonnegative(),
  expanded_ranges: z.array(rangeVisualRangeSchema),
  expanded_range_count: z.number().int().nonnegative(),
  expanded_paragraph_count: z.number().int().nonnegative(),
  expanded_table_count: z.number().int().nonnegative(),
  mapping_enabled: z.boolean(),
  uploaded_report_filename: z.string().optional(),
}).passthrough();

export const turnitinUploadResponseSchema = z.object({
  ok: z.literal(true),
  job_id: z.string().uuid(),
  analysis: turnitinAnalysisSchema,
  pdf_preview_url: z.string(),
  pdf_download_url: z.string(),
}).strict();

export const rangeEditConfigurationResponseSchema = z.object({
  ok: z.literal(true),
  configuration: z.object({
    configured: z.boolean(),
    default_model: z.string(),
    key_source: z.string(),
  }).strict(),
  batch_item_limit: z.number().int().positive(),
}).strict();

export const rangeEditDraftRequestSchema = z.object({
  visual_ranges: z.array(rangeVisualRangeSchema).min(1),
  manual_only: z.boolean().default(false),
  prompt: z.string().max(6000).optional(),
  model: z.string().max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.manual_only && !value.prompt?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'OpenAI range editing requires an editorial prompt' });
  }
});

export const rangeEditItemSchema = z.object({
  id: z.string().min(1),
  section_index: z.number().int().nonnegative(),
  visual_id: z.string().min(1),
  source_text: z.string(),
  revised_text: z.string(),
  full_element_text: z.string(),
  context_before: z.string(),
  context_after: z.string(),
  style: z.string(),
  location: z.record(z.string(), z.unknown()),
  location_label: z.string(),
  start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().nonnegative(),
  source_word_count: z.number().int().nonnegative(),
  revised_word_count: z.number().int().nonnegative(),
  warning: z.string().nullable().optional(),
}).passthrough();

export const rangeEditDraftResponseSchema = z.object({
  ok: z.literal(true),
  session_id: z.string().uuid(),
  mode: z.enum(['manual', 'openai']),
  model: z.string().nullable().optional(),
  usage: z.record(z.string(), z.unknown()).nullable().optional(),
  batch_count: z.number().int().nonnegative(),
  batch_item_limit: z.number().int().positive().nullable().optional(),
  edits: z.array(rangeEditItemSchema),
}).strict();

export const reviewedRangeEditSchema = z.object({ id: z.string().min(1), revised_text: z.string() }).strict();
export const rangeEditActionRequestSchema = z.object({
  session_id: z.string().uuid(),
  edits: z.array(reviewedRangeEditSchema).min(1),
}).strict();

export const rangeEditExportResponseSchema = z.object({
  ok: z.literal(true),
  job_id: z.string().uuid(),
  replacement_count: z.number().int().nonnegative(),
  download_url: z.string(),
  log_url: z.string(),
}).strict();

export const continuedChunkSchema = z.object({
  chunk_number: z.number().int().positive(),
  extract_file: z.string(),
  edited_template_file: z.string(),
  section_indices: z.array(z.number().int().nonnegative()),
  section_count: z.number().int().nonnegative(),
  word_count: z.number().int().nonnegative(),
  text: z.string(),
}).passthrough();

export const rangeEditContinueResponseSchema = z.object({
  ok: z.literal(true),
  job_id: z.string().uuid(),
  selection_mode: z.literal('approved_range_edits'),
  mapping: z.record(z.string(), z.unknown()),
  chunks: z.array(continuedChunkSchema),
  edited_texts: z.record(z.string().regex(/^\d+$/), z.string()),
}).strict();

export type TurnitinAnalysis = z.infer<typeof turnitinAnalysisSchema>;
export type TurnitinUploadResponse = z.infer<typeof turnitinUploadResponseSchema>;
export type RangeEditConfigurationResponse = z.infer<typeof rangeEditConfigurationResponseSchema>;
export type RangeEditDraftRequest = z.infer<typeof rangeEditDraftRequestSchema>;
export type RangeEditItem = z.infer<typeof rangeEditItemSchema>;
export type RangeEditDraftResponse = z.infer<typeof rangeEditDraftResponseSchema>;
export type ReviewedRangeEdit = z.infer<typeof reviewedRangeEditSchema>;
export type RangeEditActionRequest = z.infer<typeof rangeEditActionRequestSchema>;
export type RangeEditExportResponse = z.infer<typeof rangeEditExportResponseSchema>;
export type RangeEditContinueResponse = z.infer<typeof rangeEditContinueResponseSchema>;
