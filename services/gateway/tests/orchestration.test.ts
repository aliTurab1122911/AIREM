import { describe, expect, it } from 'vitest';
import { queuedProcessorCall } from '../src/orchestration.js';
import { usageWords } from '../src/usage.js';

describe('queued processor parity', () => {
  it('routes text work to the same structured processor resources as synchronous adapters', () => {
    const rewrite = queuedProcessorCall('text_rewrite', { text: 'A valid source sample.', profile: 'natural' });
    expect(rewrite.path).toBe('/internal/v1/text/rewrite');
    expect(rewrite.body).toEqual({ text: 'A valid source sample.', profile: 'natural' });
    expect(rewrite.usageKind).toBe('text_rewrite');

    const detection = queuedProcessorCall('text_detection', { text: 'A valid diagnostic sample.' });
    expect(detection.path).toBe('/internal/v1/detection/text');
    expect(detection.usageKind).toBe('detection');
  });

  it('strips source_job_id from document processor bodies and keeps the canonical source route', () => {
    const source = '11111111-1111-4111-8111-111111111111';
    const call = queuedProcessorCall('document_rewrite', {
      source_job_id: source,
      profile: 'natural',
      engine: 'linguistic',
      style_profile: 'natural_student',
    });
    expect(call.sourceJobId).toBe(source);
    expect(call.path).toBe(`/internal/v1/rewrite-jobs/${source}/rewrite`);
    expect(call.body).not.toHaveProperty('source_job_id');
    expect(call.body.profile).toBe('natural');
  });

  it('rejects drifted or incomplete queue payloads before they reach BullMQ', () => {
    expect(() => queuedProcessorCall('text_rewrite', {})).toThrow();
    expect(() => queuedProcessorCall('document_rewrite', { profile: 'natural' })).toThrow();
    expect(() => queuedProcessorCall('formatting_apply', { source_job_id: 'not-a-uuid', settings: {} })).toThrow();
    expect(() => queuedProcessorCall('unknown', {})).toThrow();
  });
});

describe('canonical result-based accounting', () => {
  it('does not depend on x-airem-words-processed', () => {
    expect(usageWords('text_rewrite', { original_words: 137, rewritten_words: 128 })).toBe(137);
    expect(usageWords('detection', { report: { word_count: 91 } })).toBe(91);
    expect(usageWords('document_rewrite', { word_budget: { source_words: 412, original_words: 400 } })).toBe(412);
  });

  it('never charges malformed, missing or non-billable results', () => {
    expect(usageWords(undefined, { original_words: 100 })).toBe(0);
    expect(usageWords('text_rewrite', { original_words: '100' })).toBe(0);
    expect(usageWords('detection', { report: {} })).toBe(0);
    expect(usageWords('document_rewrite', { word_budget: { source_words: -1 } })).toBe(0);
  });
});
