# AIREM v12 changelog

## Added

- Manual profile option in the browser workspace.
- Thirteen front-end sliders/toggles for rewrite behaviour.
- Live numeric value labels for every slider.
- Browser persistence through `localStorage`.
- Balanced, expanded-prose and minimal-change manual presets.
- Backend validation and clamping of all submitted control values.
- Dynamic `RewriteProfile` construction through `build_manual_profile()`.
- Manual-profile details in the rewrite audit log and API response.
- CLI support for `--profile manual --manual-settings <file>`.
- Three new unit tests for manual controls.

## Retained

- Fixed protection of document structure and visible anchors.
- Duplicate-output filtering.
- Prompt/instruction-leak filtering.
- DOCX extraction, validation and reinsertion workflow.
