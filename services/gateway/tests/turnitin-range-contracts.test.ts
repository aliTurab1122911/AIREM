import { describe, expect, it } from 'vitest';
import {
  rangeEditActionRequestSchema,
  rangeEditContinueResponseSchema,
  rangeEditDraftRequestSchema,
  turnitinAnalysisSchema,
} from '@airem/contracts';

const jobId = '11111111-1111-4111-8111-111111111111';
const visualRange = {
  start_id: 'vp_2', start_offset: 0, end_id: 'vp_2', end_offset: 25,
  source: 'turnitin', pdf_pages: [3], preview: 'Mapped text',
};

describe('PR8 Turnitin and selected-range contracts', () => {
  it('requires the reviewed edit IDs and revised text expected by Flask', () => {
    const payload = {
      session_id: '22222222-2222-4222-8222-222222222222',
      edits: [{ id: 'edit_001', revised_text: 'Approved revision.' }],
    };
    expect(rangeEditActionRequestSchema.parse(payload)).toEqual(payload);
    expect(rangeEditActionRequestSchema.safeParse({ session_id: payload.session_id, replacements: ['wrong legacy contract'] }).success).toBe(false);
  });

  it('supports manual drafts without a prompt and requires a prompt for OpenAI drafts', () => {
    expect(rangeEditDraftRequestSchema.safeParse({ visual_ranges: [visualRange], manual_only: true }).success).toBe(true);
    expect(rangeEditDraftRequestSchema.safeParse({ visual_ranges: [visualRange], manual_only: false }).success).toBe(false);
    expect(rangeEditDraftRequestSchema.safeParse({ visual_ranges: [visualRange], manual_only: false, prompt: 'Improve clarity.' }).success).toBe(true);
  });

  it('preserves exact and expanded Turnitin mapping metadata', () => {
    const parsed = turnitinAnalysisSchema.parse({
      verification_status: 'verified', verification_message: 'Verified.', filename_match: true,
      original_filename: 'source.docx', reported_filename: 'source.docx', reported_word_count: 49,
      reported_ai_score: 88, submission_id: 'trn:test:123', page_count: 3, docx_token_count: 49,
      report_token_count: 49, matched_token_count: 49, content_similarity: 1, sequence_similarity: 1,
      highlight_rectangle_count: 2, highlighted_page_count: 1, highlighted_report_token_count: 12,
      mapped_highlight_token_count: 12, highlight_mapping_coverage: 1,
      exact_ranges: [visualRange], exact_range_count: 1,
      expanded_ranges: [{ ...visualRange, start_offset: 0, end_offset: 80, source: 'turnitin-expanded' }],
      expanded_range_count: 1, expanded_paragraph_count: 1, expanded_table_count: 0, mapping_enabled: true,
    });
    expect(parsed.exact_ranges[0].source).toBe('turnitin');
    expect(parsed.expanded_ranges[0].source).toBe('turnitin-expanded');
  });

  it('returns React-ready mapping, chunks and approved current text from continue', () => {
    const response = {
      ok: true as const, job_id: jobId, selection_mode: 'approved_range_edits' as const,
      mapping: { selection: { mode: 'approved_range_edits' } },
      chunks: [{ chunk_number: 1, extract_file: 'part.docx', edited_template_file: 'edit.docx', section_indices: [0], section_count: 1, word_count: 2, text: '|sec|\nApproved text\n|sec|' }],
      edited_texts: { '1': '|sec|\nApproved text\n|sec|' },
    };
    expect(rangeEditContinueResponseSchema.parse(response)).toEqual(response);
  });
});
