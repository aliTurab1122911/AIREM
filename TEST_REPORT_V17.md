# AIREM v17 Test Report

## Scope

AIREM v17 adds a live Word-style document UI to the Formatting & Caption Studio while retaining all V16 rewrite, detection and visual multi-range capabilities.

## Automated results

- 40/40 Python unit tests passed.
- All Python modules compiled successfully.
- All Jinja templates parsed successfully.
- Formatting-preview JavaScript passed Node.js syntax validation.

## Live preview coverage

Verified controls update the browser document canvas for:

- body, title, Heading 1, Heading 2, Heading 3 and caption typography;
- font family, size and colour;
- line spacing and paragraph spacing;
- A4 and Letter page size;
- portrait and landscape orientation;
- top, bottom, left and right margins;
- headers, footers and page numbers;
- page borders;
- table typography, borders, header emphasis and supported table-style approximations;
- caption SEQ-field indicators;
- Table of Contents, List of Figures and List of Tables placeholders;
- Original versus Live formatted view;
- zoom and Fit width controls.

## DOCX verification

The supplied 4,413-word project report was used for an end-to-end formatting test:

- 155 ordered document blocks rendered;
- 521 paragraph/table-cell text elements rendered;
- 141 body paragraphs detected;
- 14 tables detected;
- generated formatted DOCX reopened successfully;
- paragraph, heading and table run typography matched selected controls;
- tables and section count remained intact.

## Preview limitation

The browser canvas closely approximates DOCX formatting, but Microsoft Word may paginate section breaks, floating images, fields, headers and footers differently. The generated DOCX is the authoritative output.
