# AIREM v19.1 — Automatic OpenAI Range Batching

## Fixed

- Removed the user-facing 120-range selection failure.
- Any number of saved ranges can now be prepared for manual editing.
- OpenAI generation automatically divides ranges into ordered batches of at most 120 items.
- Batching also respects the 60,000 source-character request budget.
- Drafts are merged back in the exact original range order.
- Token usage and response IDs are aggregated across requests.
- The UI shows the expected number of API batches before generation and reports the completed batch count afterward.
- A single individually selected range above the per-request source-size budget still requires splitting because it cannot be safely divided without changing its reinsertion mapping.
