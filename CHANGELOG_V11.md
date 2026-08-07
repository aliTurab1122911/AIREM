# AIREM v11 changes

- Converted the expanded profile's narrow ratio gate into a soft target.
- Added broad sanity bounds instead of exact 1.24–1.31 rejection.
- Added one-sentence tolerance for sentence-count validation.
- Reduced false rejection caused by floating-point boundary comparisons.
- Increased candidate count from 8 to 16.
- Added additional low-risk lexical-decompression rules.
- Added deterministic, more varied framing phrases.
- Added framing penalty to candidate ranking to reduce repetitive stock wording.
- Fixed acronym and single-letter capitalisation after framing prefixes.
- Added context-aware table-cell expansion based on column headings.
- Narrowed the prompt-leak regex so ordinary uses of “output” are not rejected.
- Retained anchor, content, structure, prompt-leak and duplicate protections.
- Updated engine identifier to `airem_local_high_coverage_rewriter_v11`.
