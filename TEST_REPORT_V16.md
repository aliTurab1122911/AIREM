# AIREM v16 Test Report

## Automated tests

- Total tests: **37**
- Passed: **37**
- Failed: **0**

Coverage includes:

- local rewriting and compression;
- original-based word budgets;
- rollback policies;
- protected dates, citations, currencies and markers;
- DOCX extraction, validation and reinsertion;
- formatting, captions and Word fields;
- V3 detection output and component bounds;
- DOCX detection across paragraphs and tables;
- unlimited-cycle implementation checks;
- visual multi-range extraction;
- non-contiguous partial-span reinsertion;
- preservation of run formatting for replacement text.

## Actual uploaded report benchmark

Source: `LLM_Hallucination_Project_Progress_Report(1).docx`

| Check | Result |
|---|---:|
| Document blocks | 155 |
| Visual selectable elements | 521 |
| Total detected words | 4,413 |
| Full-file V3 detection score | 17.2 |
| Classification | Low pattern risk |
| Sample adequacy | 100% |
| Automatically selected rewrite words | 4,167 |
| Automatically selected sections | 151 |
| Natural rewrite output words | 4,167 |
| Word-count change | 0.00% |
| Selected-text detection before | 11.5 |
| Selected-text detection after | 11.0 |
| Structural validation | Passed |
| Reinserted items | 396 |
| Reopened output paragraphs | 141 |
| Reopened output tables | 14 |

## Actual multi-range round-trip

Two non-contiguous character ranges were selected from separate paragraphs in the uploaded report.

- Saved ranges: 2
- Extracted span sections: 2
- Validation: passed
- Partial replacements: 2
- Generated DOCX reopened successfully
- Paragraph and table counts remained unchanged

## Template and code checks

- Python compilation: passed
- All Jinja templates parsed: passed
- Range-selector template rendered with the uploaded report: passed
- Workspace template rendered: passed
- JavaScript syntax checks with Node.js: passed

## Environment limitation

The build environment does not contain Flask, so an HTTP test-client run was not available. Flask and its required dependencies remain listed in `requirements.txt`. All route source compiled successfully.
