import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const DISPLAY_NAME_MIN_LENGTH = 1;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const displayNameSchema = z.string().trim().min(DISPLAY_NAME_MIN_LENGTH).max(DISPLAY_NAME_MAX_LENGTH);
export const registrationSchema = z.object({ displayName: displayNameSchema, email: z.string().email().max(320).transform(v => v.trim().toLowerCase()), password: passwordSchema });

export const jobIdSchema = z.string().uuid();
export const jsonRecordSchema = z.record(z.string(), z.unknown());
export const editedTextsSchema = z.record(z.string().regex(/^\d+$/), z.string());

export const selectionModeSchema = z.enum(['automatic', 'manual', 'range', 'visual']);
export const visualRangeSchema = z.object({
  start_id: z.string().min(1), start_offset: z.number().int().nonnegative(),
  end_id: z.string().min(1), end_offset: z.number().int().nonnegative(),
  source: z.string().optional(), preview: z.string().optional(),
  pdf_pages: z.array(z.number().int().positive()).optional(), table_index: z.number().int().nonnegative().optional(),
}).passthrough();
export const rangeSelectionRequestSchema = z.object({
  selection_mode: selectionModeSchema.default('automatic'),
  selected_blocks: z.array(z.string().min(1)).optional(),
  start_order: z.number().int().nonnegative().optional(), end_order: z.number().int().nonnegative().optional(),
  visual_ranges: z.array(visualRangeSchema).optional(),
  include_headings: z.boolean().optional(), include_captions: z.boolean().optional(), include_table_headers: z.boolean().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.selection_mode === 'manual' && !v.selected_blocks?.length) ctx.addIssue({ code: 'custom', path: ['selected_blocks'], message: 'manual selection requires selected_blocks' });
  if (v.selection_mode === 'range' && (v.start_order === undefined || v.end_order === undefined)) ctx.addIssue({ code: 'custom', path: ['start_order'], message: 'range selection requires start_order and end_order' });
  if (v.selection_mode === 'visual' && !v.visual_ranges?.length) ctx.addIssue({ code: 'custom', path: ['visual_ranges'], message: 'visual selection requires visual_ranges' });
});

// The browser preview is the processor's immutable inventory of the uploaded DOCX.
export const visualRunSchema = z.object({
  text: z.string(), bold: z.boolean(), italic: z.boolean(), underline: z.boolean(),
  font_name: z.string().nullable(), font_size_pt: z.number().nullable(), colour: z.string().nullable(),
}).strict();
export const paragraphVisualLocationSchema = z.object({
  kind: z.literal('paragraph'), body_paragraph_index: z.number().int().nonnegative(),
}).strict();
export const tableVisualLocationSchema = z.object({
  kind: z.literal('table_cell_paragraph'), table_index: z.number().int().nonnegative(),
  row_index: z.number().int().nonnegative(), col_index: z.number().int().nonnegative(),
  cell_paragraph_index: z.number().int().nonnegative(),
}).strict();
export const visualLocationSchema = z.discriminatedUnion('kind', [paragraphVisualLocationSchema, tableVisualLocationSchema]);
export const visualElementSchema = z.object({
  visual_id: z.string().min(1), order: z.number().int().nonnegative(), text: z.string(), word_count: z.number().int().nonnegative(),
  runs: z.array(visualRunSchema), style: z.string(), alignment: z.enum(['left','center','right','justify']),
  left_indent_pt: z.number(), first_line_indent_pt: z.number(), list_item: z.boolean(), location: visualLocationSchema,
}).strict();
export const paragraphBlockSchema = z.object({
  block_id: z.string().min(1), order: z.number().int().nonnegative(), type: z.literal('paragraph'),
  paragraph_index: z.number().int().nonnegative(), text: z.string(), preview: z.string(), style: z.string(),
  heading_level: z.number().int().positive().nullable(), heading_path: z.array(z.string()), is_heading: z.boolean(), is_caption: z.boolean(),
  word_count: z.number().int().nonnegative(), default_selected: z.boolean(), visual: visualElementSchema,
}).strict();
export const tableCellPreviewSchema = z.object({
  row_index: z.number().int().nonnegative(), column_index: z.number().int().nonnegative(), paragraphs: z.array(visualElementSchema),
}).strict();
export const tableRowPreviewSchema = z.object({
  row_index: z.number().int().nonnegative(), cells: z.array(tableCellPreviewSchema),
}).strict();
export const tableBlockSchema = z.object({
  block_id: z.string().min(1), order: z.number().int().nonnegative(), type: z.literal('table'),
  table_index: z.number().int().nonnegative(), text: z.string(), preview: z.string(), style: z.string(), heading_level: z.null(),
  heading_path: z.array(z.string()), is_heading: z.literal(false), is_caption: z.literal(false), rows: z.number().int().nonnegative(),
  columns: z.number().int().nonnegative(), headers: z.array(z.string()), word_count: z.number().int().nonnegative(),
  default_selected: z.boolean(), rendered_rows: z.array(tableRowPreviewSchema),
}).strict();
export const documentBlockSchema = z.discriminatedUnion('type', [paragraphBlockSchema, tableBlockSchema]);
export const pageSettingsSchema = z.object({
  page_width_pt: z.number().optional(), page_height_pt: z.number().optional(), margin_top_pt: z.number().optional(),
  margin_bottom_pt: z.number().optional(), margin_left_pt: z.number().optional(), margin_right_pt: z.number().optional(),
}).passthrough();
export const documentInventorySchema = z.object({
  blocks: z.array(documentBlockSchema), visual_elements: z.array(visualElementSchema), visual_element_count: z.number().int().nonnegative(),
  block_count: z.number().int().nonnegative(), paragraph_count: z.number().int().nonnegative(), table_count: z.number().int().nonnegative(),
  default_selected_count: z.number().int().nonnegative(), word_count: z.number().int().nonnegative(), page: pageSettingsSchema,
}).strict();

// Exactly the names accepted by app.py::_resolve_rewrite_profile today.
export const rewriteProfileSchema = z.enum(['light','natural','rewrite_compress','compress','plain','expanded','conservative','balanced','manual']);
export const rewriteEngineSchema = z.enum(['linguistic','legacy']);
export const writingStyleSchema = z.enum(['natural_student','simple_student','natural_academic','plain_professional']);
export const REWRITE_PROFILES = rewriteProfileSchema.options;
export const WRITING_STYLES = writingStyleSchema.options;

export const manualRewriteSettingsSchema = z.object({
  target_change_percent: z.number().min(-35).max(20).optional(), length_tolerance: z.number().min(2).max(20).optional(),
  table_intensity: z.number().min(0).max(100).optional(), lexical_intensity: z.number().min(0).max(100).optional(),
  connector_intensity: z.number().min(0).max(100).optional(), contraction_intensity: z.number().min(0).max(100).optional(),
  compression_intensity: z.number().min(0).max(100).optional(), candidate_count: z.number().int().min(2).max(32).optional(),
  max_sentence_words: z.number().int().min(20).max(80).optional(), content_preservation: z.number().min(60).max(100).optional(),
  table_preservation: z.number().min(72).max(100).optional(), max_cumulative_increase: z.number().min(0).max(25).optional(),
  split_long_sentences: z.boolean().optional(), preserve_sentence_count: z.boolean().optional(),
  sentence_count_tolerance: z.number().int().min(0).max(3).optional(),
}).strict();
const rewriteControlsBaseSchema = z.object({
  profile: rewriteProfileSchema.default('natural'), engine: rewriteEngineSchema.optional(), style_profile: writingStyleSchema.optional(),
  protected_terms: z.array(z.string().min(1)).optional(), manual_settings: manualRewriteSettingsSchema.optional(),
}).strict();
const requireManualSettings = <T extends { profile?: string; manual_settings?: unknown }>(v: T, ctx: z.RefinementCtx) => {
  if (v.profile === 'manual' && !v.manual_settings) ctx.addIssue({ code: 'custom', path: ['manual_settings'], message: 'manual profile requires manual_settings' });
  if (v.profile !== 'manual' && v.manual_settings) ctx.addIssue({ code: 'custom', path: ['manual_settings'], message: 'manual_settings are only valid with profile=manual' });
};
export const rewriteRequestSchema = rewriteControlsBaseSchema.superRefine(requireManualSettings);
export const rewriteCycleRequestSchema = rewriteControlsBaseSchema.extend({ edited_texts: editedTextsSchema }).strict().superRefine(requireManualSettings);
export const validationRequestSchema = z.object({ edited_texts: editedTextsSchema }).strict();
export const reinsertionRequestSchema = validationRequestSchema;
export const textRewriteRequestSchema = z.object({
  text: z.string().min(1), profile: rewriteProfileSchema.optional(), manual_settings: manualRewriteSettingsSchema.optional(),
  preserve_line_breaks: z.boolean().optional(), engine: rewriteEngineSchema.optional(), style_profile: writingStyleSchema.optional(),
  cycle_seed: z.number().int().nonnegative().optional(), protected_terms: z.array(z.string().min(1)).optional(),
}).strict().superRefine((v, ctx) => { if (v.profile === 'manual' && !v.manual_settings) ctx.addIssue({ code: 'custom', path: ['manual_settings'], message: 'manual profile requires manual_settings' }); });
export const textDetectionRequestSchema = z.object({ text: z.string().min(1) }).strict();
export const formattingSettingValueSchema = z.union([z.string(),z.number(),z.boolean()]);
export const formattingApplyRequestSchema = z.object({ settings: z.record(z.string(), formattingSettingValueSchema) }).strict();

export const rangeDraftSchema = z.object({ visual_ranges: z.array(visualRangeSchema).min(1), manual_only: z.boolean().optional(), prompt: z.string().optional(), model: z.string().optional() }).strict();
export const rangeExportSchema = z.object({ session_id: z.string().min(1), replacements: z.array(z.string()).optional(), edited_texts: editedTextsSchema.optional() }).strict();
export const rangeContinueSchema = rangeExportSchema;
export const openAiRangeEditSchema = rangeDraftSchema.extend({ manual_only: z.literal(false).optional() }).strict();

export const publicJobSchema = z.object({
  job_id: jobIdSchema, job_type: z.string().nullable().optional(), original_filename: z.string().nullable().optional(), max_words: z.number().int().nullable().optional(),
  selection_mode: selectionModeSchema.nullable().optional(), selected_block_count: z.number().int().nonnegative(), visual_range_count: z.number().int().nonnegative(),
  rewrite_cycle_count: z.number().int().nonnegative(), rewrite_pass_count: z.number().int().nonnegative(), has_extraction: z.boolean(), has_final_document: z.boolean(), download_url: z.string().optional(),
}).strict();
export const documentUploadResponseSchema = z.object({ ok: z.literal(true), job_id: jobIdSchema, job: publicJobSchema, inventory: documentInventorySchema }).strict();
export const documentJobResponseSchema = z.object({ ok: z.literal(true), job: publicJobSchema, inventory: documentInventorySchema.nullable(), mapping: jsonRecordSchema.nullable() }).strict();
export const extractionChunkSchema = z.object({
  chunk_number: z.number().int().positive(), extract_file: z.string(), edited_template_file: z.string(), section_indices: z.array(z.number().int().nonnegative()),
  section_count: z.number().int().nonnegative(), word_count: z.number().int().nonnegative(), text: z.string(),
}).passthrough();
export const extractionResponseSchema = z.object({ ok: z.literal(true), job_id: jobIdSchema, mapping: jsonRecordSchema, chunks: z.array(extractionChunkSchema) }).strict();
export const chunksResponseSchema = extractionResponseSchema;

export const validationReportSchema = z.object({
  valid: z.boolean(), issue_count: z.number().int().nonnegative(), section_count_expected: z.number().int().nonnegative(), section_count_actual: z.number().int().nonnegative(),
  chunks: z.array(jsonRecordSchema), issues: z.array(jsonRecordSchema), can_reinsert: z.boolean().optional(), validation_report_url: z.string().optional(), rewrite_log_url: z.string().optional(),
}).passthrough();
export const rewriteResponseSchema = z.object({
  ok: z.boolean(), pass_accepted: z.boolean(), rollback_policy: z.string(), rollback_reason: z.string().nullable(), operation: z.enum(['initial_rewrite','cycle']),
  cycle_number: z.number().int().nonnegative(), unlimited_rewrite_cycles: z.literal(true), engine: rewriteEngineSchema, ml_used: z.literal(false), style_profile: z.string(), profile: rewriteProfileSchema,
  edited_texts: editedTextsSchema, attempted_texts: editedTextsSchema.nullable().optional(), chunk_logs: z.array(jsonRecordSchema), validation: validationReportSchema,
  attempted_validation: validationReportSchema, pass_evaluation: jsonRecordSchema, word_budget: jsonRecordSchema, rewrite_log_url: z.string(), cycle_log_url: z.string().nullable().optional(), style_scores: jsonRecordSchema,
}).strict();
export const validationResponseSchema = z.object({ ok: z.boolean(), validation: validationReportSchema }).strict();
export const reinsertionResponseSchema = z.object({ ok: z.literal(true), job_id: jobIdSchema, replacement_count: z.number().int().nonnegative(), download_url: z.string(), replacement_log_url: z.string() }).strict();
export const textRewriteResponseSchema = z.object({
  ok: z.literal(true), profile: rewriteProfileSchema, engine: z.string(), ml_used: z.literal(false), style_profile: z.string(), profile_config: jsonRecordSchema,
  original_text: z.string(), rewritten_text: z.string(), original_words: z.number().int().nonnegative(), rewritten_words: z.number().int().nonnegative(), word_change: z.number().int(), word_change_percent: z.number(),
  score_before: z.number(), score_after: z.number(), detection_before: jsonRecordSchema, detection_after: jsonRecordSchema, score_change: z.number(), changed_lines: z.number().int().nonnegative(), line_count: z.number().int().nonnegative(),
  logs: z.array(jsonRecordSchema), document_glossary: z.array(z.string()), rewrite_note: z.string(), disclaimer: z.string(),
}).strict();
export const detectionResponseSchema = z.object({ ok: z.literal(true), report: jsonRecordSchema }).strict();
export const detectionFileResponseSchema = z.object({ ok: z.literal(true), filename: z.string(), report: jsonRecordSchema }).strict();
export const formattingAnalysisResponseSchema = z.object({ ok: z.literal(true), job_id: jobIdSchema, analysis: jsonRecordSchema, preview: jsonRecordSchema }).strict();
export const formattingApplyResponseSchema = z.object({ ok: z.literal(true), job_id: jobIdSchema, result: jsonRecordSchema, download_url: z.string(), report_url: z.string() }).strict();
export const turnitinResponseSchema = z.object({ ok: z.literal(true), job_id: jobIdSchema, analysis: jsonRecordSchema, pdf_preview_url: z.string(), pdf_download_url: z.string() }).strict();
export const processorErrorResponseSchema = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }).strict() }).passthrough();
export const errorResponseSchema = z.object({ error: z.object({ code: z.string(), message: z.string().optional(), issues: z.array(z.object({ path: z.string(), message: z.string() })).optional() }), requestId: z.string() });
export const progressStateSchema = z.enum(['queued','processing','review_required','completed','failed','expired']);
export const jobResponseSchema = z.object({ job_id: jobIdSchema, state: progressStateSchema.optional() }).passthrough();

export type SelectionMode = z.infer<typeof selectionModeSchema>;
export type VisualRange = z.infer<typeof visualRangeSchema>;
export type VisualRun = z.infer<typeof visualRunSchema>;
export type VisualElement = z.infer<typeof visualElementSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type DocumentInventory = z.infer<typeof documentInventorySchema>;
export type RangeSelectionRequest = z.infer<typeof rangeSelectionRequestSchema>;
export type RewriteProfile = z.infer<typeof rewriteProfileSchema>;
export type RewriteEngine = z.infer<typeof rewriteEngineSchema>;
export type WritingStyle = z.infer<typeof writingStyleSchema>;
export type ManualRewriteSettings = z.infer<typeof manualRewriteSettingsSchema>;
export type RewriteRequest = z.infer<typeof rewriteRequestSchema>;
export type RewriteCycleRequest = z.infer<typeof rewriteCycleRequestSchema>;
export type ValidationRequest = z.infer<typeof validationRequestSchema>;
export type ReinsertionRequest = z.infer<typeof reinsertionRequestSchema>;
export type TextRewriteRequest = z.infer<typeof textRewriteRequestSchema>;
export type TextDetectionRequest = z.infer<typeof textDetectionRequestSchema>;
export type FormattingApplyRequest = z.infer<typeof formattingApplyRequestSchema>;
export type RangeEditRequest = z.infer<typeof openAiRangeEditSchema>;
export type DocumentUploadResponse = z.infer<typeof documentUploadResponseSchema>;
export type DocumentJobResponse = z.infer<typeof documentJobResponseSchema>;
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;
export type RewriteResponse = z.infer<typeof rewriteResponseSchema>;
export type ValidationResponse = z.infer<typeof validationResponseSchema>;
export type ReinsertionResponse = z.infer<typeof reinsertionResponseSchema>;
export type TextRewriteResponse = z.infer<typeof textRewriteResponseSchema>;
export type DetectionResponse = z.infer<typeof detectionResponseSchema>;
export type DetectionFileResponse = z.infer<typeof detectionFileResponseSchema>;
export type FormattingAnalysisResponse = z.infer<typeof formattingAnalysisResponseSchema>;
export type FormattingApplyResponse = z.infer<typeof formattingApplyResponseSchema>;
export type TurnitinResponse = z.infer<typeof turnitinResponseSchema>;
export type ProgressState = z.infer<typeof progressStateSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;