# AIREM v15 Changelog

## Added

- New multi-tool home dashboard.
- Standalone copy-and-paste text rewriter.
- Full-document block inventory before extraction.
- Automatic, range-based and manual DOCX content selection.
- Optional heading, caption and table-header extraction.
- DOCX formatting audit.
- Document-wide typography and page-layout controls.
- Table formatting controls.
- Manual caption conversion to Word `SEQ` fields.
- Page numbers, Table of Contents, List of Figures and List of Tables.
- Strict, Balanced and Permissive rollback policies.
- Balanced rollback as the default.
- V15 tests for all newly introduced modules.

## Changed

- The original upload screen no longer immediately creates extracts.
- The rewrite workspace displays the chosen selection mode and block count.
- Global pass acceptance is configurable rather than permanently strict.
- Line-level minimum objective threshold was reduced from 0.25 to 0.0 so small valid improvements are not discarded before global evaluation.
- Engine and audit-log identifier updated to `airem_document_studio_v15`.

## Preserved safeguards

- Hard word-count budget against the original upload.
- Exact DOCX section and line mapping.
- Protected factual anchors.
- Structural validation before reinsertion.
- Rewrite-cycle limits and complete audit logs.
