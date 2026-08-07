# AIREM v19 — OpenAI Range Edit Studio

## Added

- OpenAI-assisted editing panel beneath Saved Rewrite Ranges.
- Server-side `OPENAI_API_KEY` and configurable `OPENAI_MODEL`.
- Responses API integration using structured JSON output and `store=false`.
- Prompt-based editing of all selected manual or Turnitin-mapped ranges.
- Manual-only range editor that works without an API key.
- Original-versus-revised cards for every selected range.
- Editable LLM outputs before any reinsertion.
- Temporary live preview of approved range edits in the Word-style document canvas.
- Direct reinsertion and DOCX export without running AIREM's local rewrite engine.
- Option to continue into AIREM with approved range edits prefilled as the starting text.
- Per-session edit logs and direct reinsertion logs.

## Safeguards

- API keys are never embedded in browser JavaScript.
- Selected text is only sent when the user explicitly generates drafts.
- The model is instructed to preserve facts, citations, names, numbers, code and technical terminology.
- The model is not instructed to bypass academic-integrity or authorship-detection systems.
- Direct export still uses AIREM's exact span-matching and formatting-preserving reinsertion engine.
