# AIREM v21 — Pure Linguistic Rewriter

## Rewriter redesign

- Removed FLAN-T5, BART, PEGASUS, Sentence-Transformers and NLI from the normal rewriting algorithm and UI.
- Replaced Content-first V1 with **Linguistic V1**, a pure-Python deterministic rewriter.
- Restored the strongest ideas from AIREM v12: high-coverage lexical variants, conversational coordination and decompression-style variants, but uses them only as intermediate alternatives.
- Added a post-rewrite compression stage so v12-style variation does not retain the old 126% expansion target.
- Detection is diagnostic only and is never used to generate, rank, accept or roll back a rewrite.

## Protected Content Registry

Before rewriting, AIREM isolates and restores exact factual/technical anchors including:

- numbers, percentages and currencies;
- dates, times, years, measurements and dimensions;
- citations, quotations, URLs, email addresses and DOIs;
- equations, code-like identifiers, function calls, file names and version/model strings;
- acronyms, likely names/organisations and repeated specialist terminology;
- user-supplied protected terms.

The rewritten candidate cannot be accepted when a protected placeholder is lost or duplicated.

## Linguistic techniques

- formal-to-direct lexical substitutions;
- nominalisation compression;
- connector simplification;
- contractions in student/plain styles;
- safe subordinate-clause reordering;
- fronted-adjunct movement;
- long-sentence splitting at safe punctuation boundaries;
- V12 conversational/decompression intermediate candidates;
- deterministic cycle variation so later manual passes can explore different wording;
- adjacent near-duplicate sentence compression.

## Word count and cycles

- Rewrite first, compress second.
- Natural rewriting targets approximately the original length without intentional expansion.
- Rewrite + Compress and Compress modes target shorter output.
- Manual rewrite cycles are unlimited.
- Removed detection/quality rollback policies. Only structural and protected-content safety can force a fallback.

## Other AIREM features retained

Turnitin highlight mapping, visual multi-range selection, optional OpenAI range editing, detection-only mode, pasted-text rewriting, DOCX formatting/captions, TOC/List of Figures/List of Tables and reinsertion remain available.
