# AIREM v20 — Content-First Local ML Rewriter Test Report

## Build objective

Implement a rewriting architecture in which the source document remains the authority for facts, claims, protected values and the permanent word-count baseline, but no longer acts as the preferred style or sentence-structure template.

## New components tested

- Content-plan extraction: claims, clauses, keywords, relations and protected anchors.
- Independent human-style profiles.
- Deterministic candidates plus optional FLAN-T5, BART and PEGASUS candidate adapters.
- Sentence-Transformers semantic verification with TF-IDF/canonical-token fallback.
- Local NLI verification with deterministic negation/directional-claim fallback.
- Claim-coverage validation.
- Excessive lexical and sequence-similarity penalties.
- Multi-objective candidate selection.
- Pasted-text and DOCX workflow integration.
- Optional local-model status and installation workflow.

## Automated regression suite

```text
51 passed in 2.47 seconds
```

The suite includes all tests inherited from v13.1 through v19.1 plus four new v20 tests.

### New v20 test cases

1. Content plans separate claims from protected values.
2. A structurally independent safe candidate outranks a superficial paraphrase.
3. The original remains the factual baseline rather than the style target.
4. ML component status checks do not download models.

## Mocked local-model selection test

Source:

> The framework checks each claim against retrieved evidence and flags unsupported statements. This process improved factual accuracy by 17.5% in 2024.

Selected candidate:

> By 2024, factual accuracy improved by 17.5%. The framework did this by checking claims against retrieved evidence and flagging unsupported statements.

Results:

| Metric | Result |
|---|---:|
| Selected generator | `mock_content_driven` |
| Word ratio | 1.000 |
| Semantic similarity | 0.940 |
| Claim coverage | 0.940 |
| Entailment | 0.940 |
| Contradiction risk | 0.020 |
| Linguistic independence | 0.962 |
| Human-style profile fit | 89.89 |
| AIREM diagnostic score | 11.0 → 9.8 |
| Utility improvement over source | +18.15 |

A deliberately unsafe candidate that changed `17.5%` to `18%` was rejected for both protected-anchor change and contradiction risk.

## Supplied DOCX benchmark

Input: `4_org_fin (8).docx`

The build environment did not contain Transformers, Sentence-Transformers or downloadable Hugging Face model weights. This benchmark therefore exercised the production fallback path: content planning, deterministic candidates, canonical TF-IDF semantic verification and heuristic contradiction checks.

| Measure | Original | Legacy rewrite | Content-first fallback |
|---|---:|---:|---:|
| Selected words | 2,604 | 2,562 | 2,562 |
| AIREM diagnostic score | 18.7 | 17.6 | 17.6 |
| Extracted sections | 60 | 60 | 60 |
| Structural validation | — | Passed | Passed |
| Changed lines | — | 16 | 13 |
| Runtime | — | 0.55 s | 2.77 s |

The content-first result was reinserted into the original DOCX and reopened successfully:

- 207 document paragraphs
- 6 tables
- no section-count mismatch

## Interface verification

- Nine Jinja templates parsed successfully.
- Python compilation completed successfully.
- `text_rewriter.html` JavaScript passed `node --check`.
- `workspace.html` JavaScript passed `node --check` after Jinja placeholders were neutralised.

## Limitations of this build test

- Live FLAN-T5, BART, PEGASUS, Sentence-Transformers and NLI inference could not be executed because the build environment has no package/model download access.
- The full local-model request path was tested through deterministic mock generators and verifiers.
- On a user machine, run `install_local_ml.bat` or `install_local_ml.sh` to install dependencies and cache the default local models.
- Model-generated candidates remain subject to the same protected-anchor, semantic, contradiction, word-budget and structure gates as deterministic candidates.
- The diagnostic score is an internal writing-pattern measure, not proof of authorship and not a guarantee of any third-party detector result.
