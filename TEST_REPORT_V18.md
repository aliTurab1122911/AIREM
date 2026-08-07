# AIREM v18 Test Report

## Scope

AIREM v18 adds verified Turnitin AI-writing report mapping to the existing DOCX range selector. The implementation was tested against the supplied original DOCX and its supplied Turnitin PDF report, plus synthetic regression documents.

## Supplied-file verification

Source files:

- Original DOCX: `4_org_fin (8).docx`
- Turnitin report: `4_org_fin (8) (1).pdf`

Observed report metadata and mapping results:

| Measure | Result |
|---|---:|
| Turnitin report pages | 35 |
| Reported source filename | `4_org_fin (8).docx` |
| Uploaded source filename after safe-name normalisation | `4_org_fin_8.docx` |
| Filename verification | Match |
| Reported Turnitin AI-writing score | 90% |
| DOCX visual blocks | 213 |
| DOCX selectable visual elements | 337 |
| DOCX inventory words | 3,116 |
| DOCX alignment tokens | 3,083 |
| Turnitin submission tokens | 3,091 |
| Matched tokens | 2,986 |
| Content match against shorter token sequence | 96.85% |
| Sequence similarity | 96.73% |
| Cyan highlight rectangles detected | 209 |
| Pages containing cyan highlights | 20 |
| Highlighted report tokens | 2,179 |
| Highlighted tokens mapped to DOCX | 2,138 |
| Highlight mapping coverage | 98.12% |
| Exact DOCX ranges created | 66 |
| Expanded paragraph targets | 42 |
| Expanded complete-table targets | 4 |
| Expanded top-level ranges | 46 |

The report was classified as a verified match and automatic mapping was enabled.

## Exact-highlight pipeline test

- 66 exact mapped ranges were converted to 66 reinsertable DOCX span sections.
- The extracted exact-highlight set contained 2,139 words.
- The generated extraction marker structure validated successfully.
- Reinserting unchanged extracted content produced a DOCX that reopened successfully with `python-docx`.

## Expanded-context pipeline test

- One-click expansion converted mapped fragments to complete containing paragraphs and complete tables.
- 46 top-level expanded selections produced 124 reinsertable paragraph/table-cell span sections.
- The expanded selection contained 2,470 words.
- Marker validation passed.
- Reinserting unchanged expanded content produced a DOCX that reopened successfully.

## UI and integration checks

- Turnitin PDF upload is available inside the DOCX range selector.
- The UI displays content-match percentage, filename result, Turnitin score, mapping coverage and mapped-range counts.
- Automatic mapping buttons are disabled for mismatched or insufficiently mapped reports.
- The original DOCX preview and Turnitin PDF viewer are displayed side by side on wide screens and stack responsively on smaller screens.
- **Map Turnitin highlights to DOCX** loads all exact mapped character spans.
- **Expand all to full paragraphs/tables** expands all mapped fragments in one action.
- Mapped ranges are displayed in cyan in Chromium-based browsers through the CSS Custom Highlight API.
- Manual ranges remain supported and can be combined with Turnitin ranges.
- The mapped ranges feed the existing extraction, rewrite, validation and reinsertion pipeline.
- Rendered range-selector JavaScript passed `node --check` with and without an attached report.
- Jinja template parsing passed.
- Python bytecode compilation passed.

## Automated regression suite

- 43 automated tests passed.
- This includes 40 retained V13-V17 tests and 3 new V18 tests for:
  - verified report mapping;
  - mismatch blocking;
  - Turnitin UI controls.

## PDF inspection

The supplied 35-page report was rendered successfully to page images. PyMuPDF inspection confirmed that the visible cyan Turnitin markings are vector-filled rectangles rather than PDF highlight annotations, so V18 reads rectangle geometry and maps intersecting text tokens.

## Environment limitation

The build environment did not contain Flask, and offline package installation was unavailable. Therefore, Flask HTTP test-client execution was not run here. `Flask` remains pinned in `requirements.txt`; all route modules compiled, templates parsed, mapping services executed, and the end-to-end extraction/reinsertion pipeline was tested directly.

## Known limitations

- Image-only or scanned Turnitin reports may not expose vector highlights or selectable text and therefore may not map automatically.
- Reports exported from materially different Turnitin layouts may use a different highlight colour; the detector uses a tolerant cyan colour range but may need future calibration.
- Browser PDF rendering and Word-style preview pagination are approximate and are not page-synchronised.
- Turnitin's reported AI percentage is displayed from the report. AIREM does not reproduce or validate Turnitin's proprietary detection model.
