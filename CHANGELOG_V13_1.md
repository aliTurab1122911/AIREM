# Changelog v13.1

## Fixed

- Replaced the misleading generic section-count error for empty edited chunks with `empty_edited_chunk`.
- Added distinct diagnostics for divider-only input, missing `|sec|` dividers, section-count mismatches and line-count mismatches.
- Added validation-report input diagnostics: field presence, character count, non-empty line count and divider count.
- Blocked browser-side validation and reinsertion when any edited part is empty.
- Made `/validate` and `/reinsert` tolerate malformed or absent JSON fields and return structural diagnostics instead of unrelated request errors.
- Saved `can_reinsert` and `validation_report_url` inside the downloadable validation report.

## Verified

- Word bullet and numbered list paragraphs validate correctly when the app-generated section markers are preserved.
- Empty content now reports that it is not a list-formatting error.
