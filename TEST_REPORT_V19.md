# AIREM v19 Test Report

## Scope

This build adds an OpenAI-assisted and manual range-editing layer to the Word preview and Turnitin mapping workflow.

## Implemented checks

- OpenAI edit panel appears beneath Saved Rewrite Ranges.
- API key remains server-side through `OPENAI_API_KEY`.
- Default model is configurable through `OPENAI_MODEL`.
- OpenAI Responses API request uses structured JSON output.
- API request sets `store=false`.
- Manual-only edit preparation works without an API key.
- Every selected range produces an editable review card.
- Revised outputs can be changed manually before reinsertion.
- Temporary document-preview replacement can be enabled and restored.
- Approved range edits can be reinserted directly into a new DOCX.
- Approved range edits can be converted into a normal AIREM extraction package and prefilled in the rewrite workspace.
- Multiple spans in paragraphs and table cells use the existing formatting-preserving reinsertion engine.
- Export filenames include the edit-session identifier to prevent accidental overwriting.

## Automated results

- **46 automated tests passed**.
- All Python modules compiled successfully.
- All 9 Jinja templates parsed successfully.
- Rendered range-selector JavaScript passed `node --check`.
- Existing V14–V18 regression tests remained green.
- New V19 tests cover:
  - edit-item construction;
  - manual range drafts;
  - paragraph and table-cell reinsertion;
  - surrounding text preservation;
  - run-format preservation;
  - structured OpenAI request arguments;
  - `store=false`;
  - UI controls and route presence;
  - AIREM workspace prefill support.

## Real-document verification

The supplied `4_org_fin (8).docx` was used for an additional end-to-end range test:

- a selected repeated phrase was mapped to its exact paragraph span;
- the phrase was replaced directly;
- the revised DOCX reopened successfully;
- the same approved edit was converted into an AIREM extraction package;
- the prefilled edited chunk passed structural validation.

## Environment limitations

- No live OpenAI request was submitted because no user API key was available in the build environment. The request path was tested with a deterministic mocked Responses API client.
- Flask was not installed in the build container and external package installation was unavailable. Route code passed Python compilation and source-level regression checks. `run_app.bat` installs Flask and the OpenAI SDK from `requirements.txt` in the user's normal environment.
