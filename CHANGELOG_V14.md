# Changelog v14 — Rewriter Engine V2

## Added

- Score-aware and length-aware candidate ranking.
- Permanent original-document word-count baseline.
- Global word-budget report with target and hard maximum.
- Automatic rollback for non-improving or over-budget passes.
- Maximum rewrite-cycle enforcement.
- `Light Rewrite`, `Natural Rewrite`, `Rewrite + Compress` and `Compress Only` profiles.
- Manual negative or positive target word-count change.
- Constrained compression rules and local grammar repairs.
- Length-neutral style-risk model with domain-term adjustment.
- Legacy style score retained in audit results.
- Global pass objective and detailed attempted-versus-accepted audit logging.

## Changed

- `balanced` now aliases `natural`.
- `conservative` now aliases `light`.
- Expansion is no longer the default rewrite strategy.
- Intentional expansion is capped at 125% of the original text.
- Repeated rewrite passes can no longer establish a larger word-count baseline.
- The interface now reports accepted and rolled-back passes separately.

## Preserved

- DOCX extraction and reinsertion mapping.
- `|sec|` structural validation.
- Protected citations, figures, dates, currencies, URLs and percentages.
- Empty-input validation diagnostics introduced in v13.1.
