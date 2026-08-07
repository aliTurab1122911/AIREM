# AIREM v18 — Turnitin Highlight Mapping Studio

## Added

- Turnitin AI-writing PDF upload on the document range-selection screen.
- Content-sequence verification and filename comparison before automatic mapping.
- Extraction of Turnitin cyan AI-writing highlights from PDF vector rectangles.
- Token-level monotonic alignment from the report back to DOCX paragraphs and table cells.
- Side-by-side Word-style DOCX preview and inline Turnitin PDF viewer.
- **Map Turnitin highlights to DOCX** for exact character-level selection.
- **Expand all to full paragraphs/tables** for one-click contextual expansion.
- Visual cyan highlighting of mapped ranges in the DOCX browser preview.
- Exact and expanded mapped ranges can be combined with manually selected ranges.
- Mapping diagnostics including content match, filename match, report score, range count and highlight coverage.

## Safeguards

- Automatic mapping is disabled when the report does not sufficiently match the uploaded DOCX.
- Automatic mapping is disabled when fewer than 80% of highlighted report tokens can be aligned.
- Turnitin overview, header and footer text is excluded from document matching.
- Mapping preserves the existing structural validation, protected-anchor checks and reinsertion safeguards.

## Dependency

- Added PyMuPDF for PDF text, coordinate and vector-highlight extraction.
