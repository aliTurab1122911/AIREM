import { describe, expect, it } from 'vitest';
import {
  formattingApplyRequestSchema,
  textRewriteRequestSchema,
  textDetectionRequestSchema,
} from '@airem/contracts';

describe('secondary v21 studio contracts', () => {
  it('keeps paste rewrite cycles on the canonical deterministic controls', () => {
    const parsed = textRewriteRequestSchema.parse({
      text: 'A complete sentence for rewriting.',
      profile: 'natural',
      engine: 'linguistic',
      style_profile: 'natural_student',
      preserve_line_breaks: true,
      cycle_seed: 7,
      protected_terms: ['AIREM', 'Task A1'],
    });
    expect(parsed.cycle_seed).toBe(7);
    expect(parsed.preserve_line_breaks).toBe(true);
    expect(parsed.protected_terms).toEqual(['AIREM', 'Task A1']);
  });

  it('keeps detection input text-only at the request boundary', () => {
    expect(textDetectionRequestSchema.safeParse({ text: 'Analyse this sample.' }).success).toBe(true);
    expect(textDetectionRequestSchema.safeParse({ text: 'Analyse this sample.', rewrite: true }).success).toBe(false);
  });

  it('preserves formatting numbers and booleans in nested JSON settings', () => {
    const payload = formattingApplyRequestSchema.parse({
      settings: {
        body_font: 'Arial',
        body_size: 12.5,
        line_spacing: 1.5,
        orientation: 'landscape',
        margin_left: 0.8,
        page_border: true,
        repeat_header: true,
        add_toc: false,
        page_numbers: true,
      },
    });

    expect(typeof payload.settings.body_size).toBe('number');
    expect(typeof payload.settings.line_spacing).toBe('number');
    expect(typeof payload.settings.margin_left).toBe('number');
    expect(typeof payload.settings.page_border).toBe('boolean');
    expect(typeof payload.settings.add_toc).toBe('boolean');
    expect(payload.settings.orientation).toBe('landscape');
  });
});
