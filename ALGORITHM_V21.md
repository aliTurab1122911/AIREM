# Linguistic V1 Algorithm Specification

## Core rule

Preserve the source document's factual payload, not its exact linguistic fingerprint.

## Stage A — Protection

A protected registry isolates exact spans before any lexical processing. Hard locks include numerical data, dates, percentages, currencies, citations, quotations, URLs/emails, equations, identifiers, measurements, versions and acronyms. Entity/technical locks include likely names and repeated specialist phrases. Users may add custom protected terms.

Each occurrence is replaced by a unique `ZXQLOCK####QXZ` placeholder. A candidate is unsafe if a placeholder is missing or duplicated. Exact source values are restored after rewriting.

## Stage B — Candidate generation

For every mapped sentence/line the engine can create:

- source unchanged;
- lexical simplification alternatives;
- connector alternatives;
- nominalisation/compression alternatives;
- safe clause-order alternatives;
- safe independent-clause semicolon splitting;
- fronted-adjunct movement;
- selected v12-inspired conversational/decompression alternatives.

The alternatives are deterministic. A cycle seed rotates lexical choices on repeat passes.

## Stage C — Compression after rewrite

Every generated candidate is passed through the compression layer before ranking. Compression removes known padding, reverses temporary v12 decompression, simplifies nominal phrases and collapses only near-duplicate adjacent sentences. Unique factual sentences are not automatically deleted.

Natural mode does not intentionally expand beyond source length. Shorter modes have stronger compression targets.

## Stage D — Candidate checks

Candidates are checked for:

- protected-placeholder integrity;
- content-token preservation;
- maximum source-relative length;
- table-specific preservation requirements.

No ML semantic model, NLI model or detector is used by this decision path.

## Stage E — Linguistic ranking

Valid candidates are ranked by:

- content preservation;
- requested word-count fit;
- linguistic independence from source wording;
- readability and long-sentence reduction;
- reduction of formulaic filler.

Near-best safe candidates may rotate across repeat cycles so unlimited manual passes can explore different deterministic wording without accepting arbitrarily poor candidates.

## Stage F — Restore and validate

Protected values are restored byte-for-byte. The DOCX workflow then checks the original section and line map. A structural failure falls back to the structurally valid source for that pass because reinsertion would otherwise be unsafe.

## Detection separation

Detection is a separate diagnostic service. A rewrite may display diagnostic before/after scores, but those scores are not inputs to candidate generation, ranking or acceptance.
