import { describe, expect, it } from 'vitest';
import {
  rangeSelectionRequestSchema,
  rewriteRequestSchema,
  rewriteCycleRequestSchema,
  validationRequestSchema,
  reinsertionRequestSchema,
  textRewriteRequestSchema,
  rewriteResponseSchema,
  extractionResponseSchema,
  writingStyleSchema,
  rewriteProfileSchema,
  manualRewriteSettingsSchema,
} from '@airem/contracts';

const jobId = '11111111-1111-4111-8111-111111111111';
const editedTexts = { '1': '|sec|\nRewritten text\n|sec|' };

describe('v21 canonical request contracts', () => {
  it('accepts only the four extraction modes implemented by document_selector', () => {
    for (const selection_mode of ['automatic', 'manual', 'range', 'visual'] as const) {
      const payload = selection_mode === 'manual'
        ? { selection_mode, selected_blocks: ['p_4'] }
        : selection_mode === 'range'
          ? { selection_mode, start_order: 2, end_order: 8 }
          : selection_mode === 'visual'
            ? { selection_mode, visual_ranges: [{ start_id: 'p_4', start_offset: 0, end_id: 'p_4', end_offset: 12 }] }
            : { selection_mode };
      expect(rangeSelectionRequestSchema.safeParse(payload).success).toBe(true);
    }
    expect(rangeSelectionRequestSchema.safeParse({ selection_mode: 'turnitin' }).success).toBe(false);
    expect(rangeSelectionRequestSchema.safeParse({ selection_mode: 'visual', visual_ranges: [{ start: 0, end: 10 }] }).success).toBe(false);
  });

  it('exposes actual v21 profiles and writing styles and rejects invented controls', () => {
    for (const profile of ['light','natural','rewrite_compress','compress','plain','expanded','conservative','balanced','manual']) {
      expect(rewriteProfileSchema.safeParse(profile).success).toBe(true);
    }
    expect(rewriteProfileSchema.safeParse('formal').success).toBe(false);
    expect(rewriteProfileSchema.safeParse('strong').success).toBe(false); // not accepted by app.py::_resolve_rewrite_profile today
    for (const style of ['natural_student','simple_student','natural_academic','plain_professional']) {
      expect(writingStyleSchema.safeParse(style).success).toBe(true);
    }
    expect(rewriteRequestSchema.safeParse({ profile: 'natural', intensity: 0.55 }).success).toBe(false);
    expect(rewriteRequestSchema.safeParse({ profile_id: 'abc' }).success).toBe(false);
    expect(rewriteRequestSchema.safeParse({ profile: 'manual' }).success).toBe(false);
    expect(rewriteRequestSchema.safeParse({ profile: 'manual', manual_settings: { target_change_percent: -4 } }).success).toBe(true);
  });

  it('matches the constrained manual settings accepted by build_manual_profile', () => {
    expect(manualRewriteSettingsSchema.safeParse({
      target_change_percent: -10,
      length_tolerance: 7,
      table_intensity: 30,
      lexical_intensity: 70,
      connector_intensity: 70,
      contraction_intensity: 0,
      compression_intensity: 70,
      candidate_count: 12,
      max_sentence_words: 34,
      content_preservation: 72,
      table_preservation: 86,
      max_cumulative_increase: 5,
      split_long_sentences: true,
      preserve_sentence_count: false,
      sentence_count_tolerance: 1,
    }).success).toBe(true);
    expect(manualRewriteSettingsSchema.safeParse({ target_change_percent: 80 }).success).toBe(false);
  });

  it('requires mapped edited_texts for cycles, validation and reinsertion', () => {
    expect(rewriteCycleRequestSchema.safeParse({ profile: 'natural', edited_texts: editedTexts }).success).toBe(true);
    expect(rewriteCycleRequestSchema.safeParse({ profile: 'natural' }).success).toBe(false);
    expect(validationRequestSchema.safeParse({ edited_texts: editedTexts }).success).toBe(true);
    expect(reinsertionRequestSchema.safeParse({ edited_texts: editedTexts }).success).toBe(true);
    expect(validationRequestSchema.safeParse({ text: 'old invented payload' }).success).toBe(false);
    expect(reinsertionRequestSchema.safeParse({ text: 'old invented payload' }).success).toBe(false);
  });

  it('keeps the paste rewriter on the same real profile/style surface', () => {
    expect(textRewriteRequestSchema.safeParse({ text: 'A sentence.', profile: 'natural', style_profile: 'natural_academic' }).success).toBe(true);
    expect(textRewriteRequestSchema.safeParse({ text: 'A sentence.', profile: 'formal' }).success).toBe(false);
    expect(textRewriteRequestSchema.safeParse({ text: 'A sentence.', intensity: 0.5 }).success).toBe(false);
  });
});

describe('v21 canonical response contracts', () => {
  it('preserves extraction mapping and chunk text without transformation', () => {
    const payload = {
      ok: true,
      job_id: jobId,
      mapping: { separator: '|sec|', section_count: 1, chunk_count: 1, chunks: [] },
      chunks: [{
        chunk_number: 1,
        extract_file: '2_extract_part_01.docx',
        edited_template_file: '3_extract_airem_part_01_paste_here.docx',
        section_indices: [0], section_count: 1, word_count: 2, text: '|sec|\nSource text\n|sec|',
      }],
    };
    const parsed = extractionResponseSchema.parse(payload);
    expect(parsed).toEqual(payload);
    expect(parsed.chunks[0].text).toBe(payload.chunks[0].text);
  });

  it('preserves the complete mapped rewrite response used by React for the next cycle', () => {
    const validation = {
      valid: true, issue_count: 0, section_count_expected: 1, section_count_actual: 1,
      chunks: [], issues: [], can_reinsert: true,
    };
    const payload = {
      ok: true,
      pass_accepted: true,
      rollback_policy: 'none',
      rollback_reason: null,
      operation: 'initial_rewrite',
      cycle_number: 0,
      unlimited_rewrite_cycles: true,
      engine: 'linguistic',
      ml_used: false,
      style_profile: 'natural_student',
      profile: 'natural',
      edited_texts: editedTexts,
      attempted_texts: null,
      chunk_logs: [],
      validation,
      attempted_validation: validation,
      pass_evaluation: { accepted: true },
      word_budget: { original_words: 2, output_words: 2 },
      rewrite_log_url: '/download/x/logs/local_rewrite_log.json',
      cycle_log_url: null,
      style_scores: { current: { word_count: 2 } },
    };
    const parsed = rewriteResponseSchema.parse(payload);
    expect(parsed).toEqual(payload);
    expect(parsed.edited_texts).toEqual(editedTexts);
  });
});
