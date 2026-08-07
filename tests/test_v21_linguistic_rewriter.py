from __future__ import annotations

import re
from pathlib import Path

from scripts.linguistic_rewriter import (
    V12_DECOMPRESSION_RULES,
    build_document_glossary,
    build_protected_registry,
    rewrite_linguistic,
)
from scripts.text_rewriter_service import rewrite_pasted_text


def test_protected_registry_locks_data_names_and_user_terms():
    text = (
        "Dr. Ayesha Khan tested Retrieval-Augmented Generation on 21 June 2026. "
        "Accuracy was 91.4%, cost was £1,250, and Python 3.13 produced model 7B output."
    )
    registry = build_protected_registry(text, ["Retrieval-Augmented Generation", "Python"])
    protected = registry.protect(text)
    assert "21 June 2026" not in protected
    assert "91.4%" not in protected
    assert "£1,250" not in protected
    assert "Dr. Ayesha Khan" not in protected
    assert "Retrieval-Augmented Generation" not in protected
    assert registry.placeholders_intact(protected)
    assert registry.restore(protected) == text
    categories = registry.summary()["categories"]
    assert categories.get("name", 0) >= 1
    assert categories.get("date", 0) >= 1
    assert categories.get("percentage", 0) >= 1
    assert categories.get("currency", 0) >= 1


def test_repeated_proper_and_technical_terms_are_detected_without_ml():
    glossary = build_document_glossary([
        "Python is used for the retrieval pipeline.",
        "The Python implementation evaluates Retrieval-Augmented Generation.",
        "Retrieval-Augmented Generation is evaluated again in Python.",
    ])
    lower = {x.lower() for x in glossary}
    assert "python" in lower
    assert any("retrieval" in x for x in lower)


def test_v12_strength_is_used_as_intermediate_without_v12_expansion_target():
    assert len(V12_DECOMPRESSION_RULES) >= 10
    source = (
        "The algorithm mirrors the supplied flowchart without changing its branching logic. "
        "At the end of each branch, control returns to the loop condition."
    )
    outputs = {
        rewrite_linguistic(source, "natural", cycle_seed=seed, style_profile_name="natural_student").rewritten
        for seed in range(6)
    }
    assert any(value != source for value in outputs)
    assert len(outputs) >= 2
    for value in outputs:
        assert len(re.findall(r"\b[\w'-]+\b", value)) <= len(re.findall(r"\b[\w'-]+\b", source))


def test_rewrite_keeps_protected_values_exact_and_does_not_use_ml():
    source = (
        "Dr. Ayesha Khan demonstrates that the FEVER pipeline improved accuracy by 17.5% in 2024. "
        "It is important to note that the system is capable of providing an explanation of the result."
    )
    result = rewrite_linguistic(
        source,
        "rewrite_compress",
        cycle_seed=3,
        user_terms=["FEVER"],
        style_profile_name="simple_student",
    )
    for anchor in ("Dr. Ayesha Khan", "FEVER", "17.5%", "2024"):
        assert anchor in result.rewritten
    assert result.metrics["rewritten_words"] <= result.metrics["original_words"]
    assert result.engine == "linguistic_v1"
    assert result.generator == "deterministic_linguistic"
    assert "detector score is not used" in result.metrics["selection_basis"]


def test_paste_rewriter_ignores_local_ml_flags_and_has_unlimited_cycle_seed():
    source = "In order to complete the task, the program utilises the supplied data and demonstrates the result."
    first = rewrite_pasted_text(source, "natural", engine="linguistic", use_local_ml=True, cycle_seed=0)
    second = rewrite_pasted_text(first["rewritten_text"], "natural", engine="linguistic", use_local_ml=True, cycle_seed=1)
    assert first["ml_used"] is False
    assert second["ml_used"] is False
    assert first["engine"] == "linguistic"
    assert "no ML models" in first["rewrite_note"]


def test_rewrite_source_has_no_transformer_or_embedding_imports():
    root = Path(__file__).resolve().parents[1]
    rewrite_sources = [
        root / "scripts" / "linguistic_rewriter.py",
        root / "scripts" / "text_rewriter_service.py",
        root / "scripts" / "local_rewriter.py",
        root / "app.py",
    ]
    combined = "\n".join(path.read_text(encoding="utf-8") for path in rewrite_sources)
    forbidden = ("sentence_transformers", "transformers import", "content_first_rewriter", "ml_component_status")
    assert not any(item in combined for item in forbidden)
