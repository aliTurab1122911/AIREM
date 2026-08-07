# AIREM v19.1 Test Report — Automatic OpenAI Range Batching

## Issue corrected

AIREM v19 rejected an OpenAI draft request when more than 120 editable ranges were selected. The limit was applied to the complete user selection rather than to each underlying API request.

## New behaviour

- The user may select more than 120 editable ranges.
- AIREM automatically splits OpenAI work into ordered batches.
- Each API request contains no more than 120 ranges.
- Each batch also remains within the 60,000-character source-text budget.
- The results are merged back in the original saved-range order.
- The interface displays the expected batch count before submission.
- The completion message displays the number of processed batches.
- Manual-edit-only mode has no 120-range limit.
- Response IDs, per-batch metadata and token usage are retained in the edit-session log.

A single selected range longer than the per-request source-text budget must still be divided manually because splitting the content internally would alter its exact DOCX span mapping.

## Automated checks

- Python compilation: passed.
- Full regression suite: **47/47 tests passed**.
- New 245-range mocked Responses API test: passed.
- Confirmed API batch sizes for 245 ranges: **120, 120, 5**.
- Confirmed output order: first through 245th range preserved.
- Confirmed token usage aggregation across three requests.
- Confirmed response ID collection across three requests.
- All nine Jinja templates parsed successfully.
- Rendered Range Selector JavaScript passed Node.js syntax validation.

## API test scope

No paid live OpenAI request was made because an API key was not available in the build environment. The complete multi-request workflow was tested using a deterministic mocked OpenAI Responses client.
