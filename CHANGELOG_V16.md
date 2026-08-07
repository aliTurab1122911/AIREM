# AIREM v16 Changelog

## Unlimited rewrite passes

- Removed the document rewriter's fixed maximum-cycle check.
- Removed the maximum-cycle slider from manual controls.
- Removed `max_cycles` from rewrite profiles.
- Added `Rewrite Output Again` to the pasted-text workflow.
- Each request remains a single bounded pass, avoiding an infinite server-side loop.

## Detection Engine V3

- Added a transparent six-dimension pattern ensemble.
- Added sample-adequacy confidence and classification bands.
- Added passage-level scoring and ranked high-risk excerpts.
- Replaced the visible V2 score in document rewriting with V3 reporting.
- Connected V3 candidate scoring to the local rewriter.
- Added full before/after reports in the paste-text rewriter.
- Added a separate Detection Studio accepting pasted text, DOCX and TXT input.

## Visual multi-range DOCX selection

- Added a Word-style browser preview using DOCX run formatting, paragraph alignment, indentation and tables.
- Added exact browser text highlighting with character offsets.
- Added multiple non-contiguous saved ranges.
- Added paragraph-span and table-cell-paragraph-span extraction mappings.
- Added run-preserving partial-text reinsertion.
- Kept automatic, block range and manual block selection modes.

## Compatibility and safeguards

- Retained the original-based word budget.
- Retained strict structural validation and protected-fact controls.
- Retained Strict, Balanced and Permissive rollback policies.
- Retained the previous formatting and caption features.
