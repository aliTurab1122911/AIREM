from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, List, Sequence

from .detection_service import detect_text
from .docx_pipeline_common import WORD_RE
from .linguistic_rewriter import build_document_glossary, rewrite_linguistic
from .local_rewriter import build_manual_profile, get_profile, rewrite_line


def word_count(text: str) -> int:
    return len(WORD_RE.findall(text or ""))


def _resolve_profile(profile_name: str, manual_settings: Dict[str, Any] | None):
    name = (profile_name or "natural").strip().lower()
    if name == "manual":
        profile = build_manual_profile(manual_settings or {})
        return name, profile
    try:
        return name, get_profile(name)
    except KeyError:
        return "natural", get_profile("natural")


def rewrite_pasted_text(
    text: str,
    profile_name: str = "natural",
    manual_settings: Dict[str, Any] | None = None,
    preserve_line_breaks: bool = True,
    engine: str = "linguistic",
    use_local_ml: bool = False,  # compatibility only; ignored
    ml_settings: Dict[str, Any] | None = None,  # compatibility only; ignored
    style_profile: str = "natural_student",
    cycle_seed: int = 0,
    protected_terms: Sequence[str] | None = None,
) -> Dict[str, Any]:
    """Rewrite pasted text without DOCX mapping.

    V21's linguistic engine is pure Python. Detection is calculated after the
    rewrite for user information only and never influences candidate selection.
    """
    source = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not source.strip():
        raise ValueError("Paste text before running the rewriter.")

    resolved_name, legacy_profile = _resolve_profile(profile_name, manual_settings)
    output_lines: List[str] = []
    logs: List[Dict[str, Any]] = []
    lines = source.split("\n") if preserve_line_breaks else [" ".join(source.split())]
    document_glossary = build_document_glossary(lines)

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            output_lines.append("")
            continue
        leading = line[: len(line) - len(line.lstrip())]
        if (engine or "linguistic").strip().lower() in {"linguistic", "linguistic_v1", "v21"}:
            result = rewrite_linguistic(
                line.strip(),
                profile_name=resolved_name,
                cycle_seed=cycle_seed + line_number,
                table_mode=False,
                user_terms=protected_terms,
                document_glossary=document_glossary,
                style_profile_name=style_profile,
                manual_profile=asdict(legacy_profile) if resolved_name == "manual" else None,
            )
            output_lines.append(leading + result.rewritten)
            logs.append({
                "line_number": line_number,
                "engine": result.engine,
                "generator": result.generator,
                "changed": result.changed,
                "original": result.original,
                "rewritten": result.rewritten,
                "metrics": result.metrics,
                "reasons": result.reasons,
                "protected": result.protected,
            })
        else:
            result = rewrite_line(
                line.strip(),
                profile_name=resolved_name,
                mode="paragraph",
                profile_override=legacy_profile if resolved_name == "manual" else None,
                context={"baseline_original_text": line.strip()},
            )
            output_lines.append(leading + result.rewritten)
            logs.append({
                "line_number": line_number,
                "engine": "legacy_v20_rules",
                "generator": "legacy_v20_rules",
                "changed": result.changed,
                "original": result.original,
                "rewritten": result.rewritten,
                "metrics": result.metrics,
                "reasons": result.reasons,
            })

    output = "\n".join(output_lines).strip()
    # Diagnostic only: not used by the rewriter.
    before = detect_text(source, table_mode=False, include_passages=True)
    after = detect_text(output, table_mode=False, include_passages=True)
    original_words = word_count(source)
    output_words = word_count(output)

    return {
        "ok": True,
        "profile": resolved_name,
        "engine": (engine or "linguistic").strip().lower(),
        "ml_used": False,
        "style_profile": style_profile,
        "profile_config": asdict(legacy_profile),
        "original_text": source,
        "rewritten_text": output,
        "original_words": original_words,
        "rewritten_words": output_words,
        "word_change": output_words - original_words,
        "word_change_percent": round((output_words / max(original_words, 1) - 1.0) * 100.0, 2),
        "score_before": before["score"],
        "score_after": after["score"],
        "detection_before": before,
        "detection_after": after,
        "score_change": round(after["score"] - before["score"], 1),
        "changed_lines": sum(1 for item in logs if item["changed"]),
        "line_count": len(lines),
        "logs": logs,
        "document_glossary": document_glossary,
        "rewrite_note": "The detector is diagnostic only. V21 rewrite selection uses no detector score and no ML models.",
        "disclaimer": "AIREM's pattern score is an experimental writing diagnostic; it does not establish authorship or guarantee an external detector result.",
    }
