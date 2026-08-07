# AIREM v10 changes

- Added the `expanded` rewrite profile.
- Added sentence-level candidate generation and scoring.
- Added controlled lexical decompression and rhetorical framing.
- Added conversational connector variants and selected contractions.
- Added sentence-count preservation for the expanded profile.
- Added content-token overlap validation.
- Added fuzzy adjacent-sentence duplicate removal.
- Added prompt/instruction leakage rejection.
- Added table header context to extraction mappings and audit logs.
- Added expanded-profile UI and CLI support.
- Added four new unit tests.
- Kept only one validated candidate; multiple alternatives are never inserted.
