# AIREM v20 — Content-First Local ML Rewriter

## Rewriter architecture

- Added a content-plan layer that extracts claims, clauses, protected values, keywords and discourse relations.
- The original extract remains the factual and word-count baseline, but no longer defines the target sentence structure or style.
- Added independent human-style profiles: Natural Academic, Concise Academic and Plain Professional.
- Added excessive lexical/sequence-similarity penalties so superficial paraphrases do not automatically outrank structurally independent candidates.
- Added claim-coverage, semantic-similarity, contradiction, protected-anchor and word-budget gates.
- Candidate ranking now separates content fidelity, style-profile fit, linguistic independence, length fit and diagnostic pattern score.

## Optional local ML

- Added lazy local FLAN-T5 candidate generation.
- Added local BART compression candidates.
- Added optional PEGASUS aggressive-summary candidates.
- Added Sentence-Transformers semantic verification when installed, with a canonical TF-IDF fallback.
- Added local NLI verification when installed, with negation/directional-claim fallback checks.
- Models are optional and load only when enabled. The deterministic engine remains available without them.

## Interface

- Added Content-first V1/Legacy engine selection to pasted-text and DOCX rewrite workspaces.
- Added human-style profile selection.
- Added local-model toggles and a model-cache status check.
- Added installer scripts and a separate optional ML requirements file.

## Safeguards

- Protected numbers, dates, percentages, currencies, citations, URLs and other anchors remain mandatory.
- Tables continue to use the stricter deterministic engine by default.
- The original document remains the permanent cumulative word-count baseline.
