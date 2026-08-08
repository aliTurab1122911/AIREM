export type UsageKind = 'text_rewrite' | 'detection' | 'document_rewrite';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeWords(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Derive billable processed words from the canonical JSON processor response.
 *
 * This deliberately removes the former dependency on the undocumented
 * x-airem-words-processed response header. The same extractor is used by the
 * synchronous gateway and the BullMQ worker, so a queued call and its direct
 * equivalent follow one accounting rule.
 */
export function usageWords(kind: UsageKind | undefined, response: unknown): number {
  if (!kind) return 0;
  const root = record(response);
  if (!root) return 0;

  if (kind === 'text_rewrite') return safeWords(root.original_words);
  if (kind === 'detection') return safeWords(record(root.report)?.word_count);
  if (kind === 'document_rewrite') {
    const budget = record(root.word_budget);
    return safeWords(budget?.source_words) || safeWords(budget?.original_words);
  }
  return 0;
}

export function usageKindForOperation(operation: string): UsageKind | undefined {
  if (operation === 'text_rewrite') return 'text_rewrite';
  if (operation === 'text_detection') return 'detection';
  if (operation === 'document_rewrite') return 'document_rewrite';
  return undefined;
}
