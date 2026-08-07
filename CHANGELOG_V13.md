# Changelog v13

## Added

- `POST /rewrite-cycle/<job_id>` for repeated rewrite passes on the current edited text.
- Cycle and rewrite-pass counters in the workspace.
- Numbered cycle audit logs under `logs/rewrite_cycles/`.
- `scripts/style_score.py` with a deterministic seven-pair style-centroid model.
- `POST /style-score/<job_id>` for initial/current score calculation.
- Initial, current and delta score cards on the front end.
- Score-history chips for every completed pass.
- Manual score recalculation for text pasted or edited in the browser.
- Four style-score unit tests.

## Behaviour

- Initial rewrite starts a new chain and resets the cycle history.
- Each cycle uses the current edited boxes, not the original extraction.
- The style score is calculated after rewriting and does not influence candidate generation, ranking or validation.
- The score may increase or decrease across cycles.
