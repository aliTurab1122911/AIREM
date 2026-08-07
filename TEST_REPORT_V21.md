# AIREM v21 — Pure Linguistic Rewriter Test Report

## Build objective

Replace the normal AIREM rewriting path with a deterministic linguistic engine that preserves factual/technical anchors, reuses the strongest transformation ideas from AIREM v12, applies compression after rewriting, and never loads Transformer/ML models during normal rewriting.

The built-in detection score remains available as a diagnostic only. It is not an optimization objective and is not used to generate, rank, accept, reject or roll back rewrite candidates.

## Final rewrite pipeline

1. Normalize source text.
2. Build a Protected Content Registry.
3. Lock exact factual/technical spans with temporary placeholders.
4. Generate lexical and sentence-structure candidates.
5. Generate selected v12-inspired conversational/decompression alternatives as intermediate candidates.
6. Apply deterministic compression to every candidate before ranking.
7. Reject candidates that lose protected spans or fail content-preservation checks.
8. Rank valid candidates on content preservation, linguistic independence, readability and requested word-count fit.
9. Restore protected content exactly.
10. Validate section/line structure before DOCX reinsertion.

## Protected Content Registry

Automatic protection covers numerical values, percentages, money, dates/times/years, measurements, dimensions, citations, quotations, URLs/emails/DOIs, equations, code-like identifiers, function calls, file names, versions/model-size strings, acronyms, likely proper names/organisations and repeated specialist terminology.

The UI also provides `Additional protected terms` so a user can explicitly lock course-, project- or domain-specific terminology.

## v12 behavior retained and corrected

The strongest v12 ideas retained are broad lexical coverage, conversational coordination, clause restructuring and decompression-style alternative paths. The v12 Expanded profile used a target near 126% of source length. v21 does not use that final expansion target. Expanded wording can exist only as an intermediate candidate and is compressed before candidate selection.

## Rewrite-cycle behavior

Manual repeat rewriting has no cycle count limit. Cycle seeds rotate among near-best deterministic alternatives. There is no detection-score or quality-improvement rollback gate. The only fallback is a structural/protected-content safety fallback required to prevent factual damage or invalid DOCX reinsertion.

## Runtime dependency scan

The normal rewrite source and rewrite interfaces contain no references to:

- FLAN-T5
- BART
- PEGASUS
- `transformers`
- `sentence_transformers`
- local NLI model loading
- the former content-first ML rewriter

The separate optional OpenAI range editor remains in the application, but it is not called by the normal Linguistic V1 rewrite path.

## Automated regression suite

```text
53 passed
```

The suite covers all retained v13.1–v19 workflows plus v21-specific tests for:

- protected registry integrity;
- automatic technical-term detection;
- v12-inspired candidate variation without the old expansion target;
- exact restoration of numbers/dates/names/technical anchors;
- unlimited-cycle seed variation;
- pasted-text rewriting with ML flags ignored;
- source scan confirming the normal rewrite path has no Transformer/embedding model imports.

## Static validation

- Python compilation: passed for `app.py` and all `scripts/*.py` files.
- Jinja template parsing: 9/9 templates passed.
- Browser JavaScript syntax: passed for `workspace.html`, `text_rewriter.html`, `range_selector.html` and `formatting_workspace.html`.

## Real-document regression 1

Input: `4_org_fin (8).docx`

| Measure | Result |
|---|---:|
| Extracted sections | 60 |
| Extracted chunks | 1 |
| Source words | 2,604 |
| Rewritten words | 2,531 |
| Word-count change | -73 (-2.80%) |
| Changed mapped lines | 27 |
| Structural validation | Passed |
| DOCX reinsertion | Passed |
| Generated DOCX reopened | Passed |
| Rewrite runtime | 1.655 s |
| Diagnostic score before | 18.7 |
| Diagnostic score after | 15.9 |

The diagnostic values above are reported only as observations; they did not participate in candidate selection.

## Real-document regression 2

Input: `LLM_Hallucination_Project_Progress_Report(1).docx`

| Measure | Result |
|---|---:|
| Extracted sections | 151 |
| Extracted chunks | 1 |
| Source words | 4,167 |
| Rewritten words | 4,166 |
| Word-count change | -1 (-0.02%) |
| Changed mapped lines | 10 |
| Structural validation | Passed |
| DOCX reinsertion | Passed |
| Generated DOCX reopened | Passed |
| Rewrite runtime | 1.280 s |
| Diagnostic score before | 11.5 |
| Diagnostic score after | 11.4 |

The second document contains many concise tables, reference entries and technical phrases. The protection and preservation rules therefore intentionally leave a larger share of its text unchanged rather than force unsafe substitutions.

## Existing studio features retained

- paste-text rewriting;
- detection-only studio;
- automatic and manual DOCX range selection;
- visual multi-range selection;
- Turnitin PDF side-by-side verification and highlight mapping;
- expand mapped highlights to complete paragraph/table regions;
- optional OpenAI/manual selected-range editing;
- formatting and caption studio with live DOCX preview;
- page numbers, headers/footers, TOC, List of Figures and List of Tables;
- structural validation and DOCX reinsertion.

## Important limitation

The linguistic engine is deterministic and rule-based. Its purpose is to improve clarity, concision and variation while preserving document facts and structure. The built-in diagnostic does not establish authorship and the application does not guarantee any result from an external detection service.
