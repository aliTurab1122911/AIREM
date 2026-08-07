# AIREM v14 Rewriter Engine V2 — Test Report

## Automated tests

- `29 passed`
- Python compilation passed for `app.py` and all modules under `scripts/`.
- Inline workspace JavaScript passed `node --check` after substituting Jinja values.

## Exact uploaded DOCX regression

Test file: `LLM_Hallucination_Project_Progress_Report(1).docx`

| Check | Result |
|---|---:|
| Extracted sections | 151 |
| Original selected words | 4,167 |
| Natural Rewrite output words | 4,167 |
| Word-count change | 0.00% |
| Initial v14 style-risk score | 10.7 |
| Natural Rewrite score | 9.4 |
| Structural validation | Passed |
| Reinserted text items | 396 |
| Paragraphs before / after | 141 / 141 |
| Tables before / after | 14 / 14 |
| Reopened generated DOCX | Passed |

## Repeat-cycle behaviour

A second Natural Rewrite pass produced no additional objective improvement:

- source score: 9.4
- attempted score: 9.4
- source words: 4,167
- attempted words: 4,167
- decision: `no_meaningful_score_and_length_improvement`
- expected application action: rollback to the previous accepted text

## Profile benchmark on the uploaded DOCX

| Profile | v14 score | Legacy score | Words | Change | Global decision |
|---|---:|---:|---:|---:|---|
| Light Rewrite | 9.4 | 80.5 | 4,167 | 0.00% | Accept |
| Natural Rewrite | 9.4 | 80.5 | 4,167 | 0.00% | Accept |
| Rewrite + Compress | 9.9 | 80.8 | 4,167 | 0.00% | Accept |
| Compress Only | 9.9 | 80.8 | 4,167 | 0.00% | Accept |
| Plain English | 9.4 | 80.5 | 4,167 | 0.00% | Accept |
| Intentional Expansion | 9.3 | 80.1 | 4,185 | +0.43% | Accept; within 125% cap |

The source report is already concise in many table cells, so compression modes correctly preserve rather than delete content when no safe shortening candidate exists.

## Environment limitation

The core pipeline and DOCX round trip were executed directly. The HTTP Flask test client was not run in the build container because Flask was not installed there and external package installation was unavailable. Flask remains declared in `requirements.txt`; route modules passed Python compilation and the workspace JavaScript passed syntax validation.
