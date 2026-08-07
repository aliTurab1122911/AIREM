from __future__ import annotations

import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence

from docx import Document

from .docx_pipeline_common import WORD_RE, cell_text, iter_block_items, parse_extract_text
from .style_score import analyse_style_v2, score_text_v2

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“‘(])")
NOMINALISATION_RE = re.compile(r"\b\w+(?:tion|sion|ment|ance|ence|ity|ness|ism|isation|ization)\b", re.I)
PASSIVE_HINT_RE = re.compile(r"\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b", re.I)
FORMULAIC_OPENERS = (
    "it is important", "it should be noted", "in conclusion", "in summary",
    "furthermore", "moreover", "therefore", "consequently", "additionally",
    "this demonstrates", "this highlights", "this indicates", "the findings suggest",
)


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def _risk(value: float, start: float, full: float) -> float:
    if full <= start or value <= start:
        return 0.0
    return _clamp((value - start) * 100.0 / (full - start))


def _inverse_risk(value: float, healthy: float, full: float) -> float:
    """Risk rises as value falls below healthy towards full."""
    if healthy <= full or value >= healthy:
        return 0.0
    return _clamp((healthy - value) * 100.0 / (healthy - full))


def _sd(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def _words(text: str) -> List[str]:
    return [w.lower().strip("'-") for w in WORD_RE.findall(text or "") if w.strip("'-")]


def _sentences(text: str) -> List[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(cleaned) if s.strip()] or [cleaned]


def _paragraphs(text: str) -> List[str]:
    normalised = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    parts = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n|\n", normalised)]
    return [p for p in parts if p]


def _moving_ttr(words: Sequence[str], window: int = 50) -> float:
    if not words:
        return 0.0
    if len(words) <= window:
        return len(set(words)) / len(words)
    values = []
    step = max(10, window // 2)
    for start in range(0, len(words) - window + 1, step):
        sample = words[start:start + window]
        values.append(len(set(sample)) / window)
    return sum(values) / max(len(values), 1)


def _sentence_length_entropy(lengths: Sequence[int]) -> float:
    if len(lengths) < 3:
        return 1.0
    buckets = Counter(min(8, max(0, length // 5)) for length in lengths)
    total = sum(buckets.values())
    entropy = -sum((count / total) * math.log2(count / total) for count in buckets.values())
    maximum = math.log2(max(len(buckets), 2))
    return entropy / maximum if maximum else 1.0


def _paragraph_uniformity(paragraphs: Sequence[str]) -> float:
    lengths = [len(_words(p)) for p in paragraphs if len(_words(p)) >= 4]
    if len(lengths) < 4:
        return 0.0
    mean = sum(lengths) / len(lengths)
    cv = _sd(lengths) / mean if mean else 1.0
    return _inverse_risk(cv, 0.55, 0.12)


def _formulaic_opener_density(sentences: Sequence[str]) -> float:
    if not sentences:
        return 0.0
    hits = 0
    for sentence in sentences:
        lower = sentence.lower().lstrip('"\'“‘(')
        if any(lower.startswith(opener) for opener in FORMULAIC_OPENERS):
            hits += 1
    return hits * 100.0 / len(sentences)


def _punctuation_uniformity(text: str, sentences: Sequence[str]) -> float:
    if len(sentences) < 5:
        return 0.0
    signatures = []
    for sentence in sentences:
        signatures.append((
            int("," in sentence), int(";" in sentence), int(":" in sentence),
            int("—" in sentence or "–" in sentence), int("(" in sentence),
        ))
    common = Counter(signatures).most_common(1)[0][1]
    return _risk(common * 100.0 / len(signatures), 55.0, 90.0)


def _confidence(word_count: int, sentence_count: int) -> float:
    # This is sample adequacy, not certainty about authorship.
    word_component = min(word_count / 1500.0, 1.0)
    sentence_component = min(sentence_count / 80.0, 1.0)
    return round(20.0 + 50.0 * word_component + 30.0 * sentence_component, 1)


def _classification(score: float) -> str:
    if score < 20:
        return "Low pattern risk"
    if score < 40:
        return "Moderate pattern risk"
    if score < 65:
        return "Elevated pattern risk"
    return "High pattern risk"


def _core_detection(text: str, table_mode: bool = False) -> Dict[str, Any]:
    text = text or ""
    words = _words(text)
    sentences = _sentences(text)
    paragraphs = _paragraphs(text)
    lengths = [len(_words(s)) for s in sentences if _words(s)]
    word_count = len(words)
    sentence_count = len(lengths)

    v2 = score_text_v2(text, table_mode=table_mode)
    metrics = analyse_style_v2(text, table_mode=table_mode)
    counts = Counter(words)
    repeated_content_words = sum(count - 1 for word, count in counts.items() if count > 3 and len(word) > 4)
    repeated_word_rate = repeated_content_words * 100.0 / max(word_count, 1)
    ttr = _moving_ttr(words)
    entropy = _sentence_length_entropy(lengths)
    formulaic_density = _formulaic_opener_density(sentences)
    nominalisations = len(NOMINALISATION_RE.findall(text)) * 1000.0 / max(word_count, 1)
    passive_hints = len(PASSIVE_HINT_RE.findall(text)) * 1000.0 / max(word_count, 1)
    punctuation_uniformity = _punctuation_uniformity(text, sentences)

    regularity = (
        _inverse_risk(float(metrics.get("sentence_cv", 0.0)), 0.58, 0.18) * 0.42
        + _inverse_risk(entropy, 0.78, 0.35) * 0.28
        + _paragraph_uniformity(paragraphs) * 0.20
        + punctuation_uniformity * 0.10
    )
    repetition = (
        _risk(float(metrics.get("repeated_trigram_pct", 0.0)), 1.0, 11.0) * 0.50
        + _risk(float(metrics.get("repeated_sentence_start_pct", 0.0)), 8.0, 48.0) * 0.30
        + _risk(repeated_word_rate, 7.0, 24.0) * 0.20
    )
    template_language = (
        _risk(float(metrics.get("formal_connectors_per_1000", 0.0)), 3.0, 17.0) * 0.28
        + _risk(float(metrics.get("filler_phrases_per_1000", 0.0)), 1.0, 10.0) * 0.25
        + _risk(formulaic_density, 6.0, 35.0) * 0.25
        + _risk(nominalisations, 20.0, 65.0) * 0.12
        + _risk(passive_hints, 8.0, 35.0) * 0.10
    )
    lexical_pattern = (
        _inverse_risk(ttr, 0.68, 0.42) * 0.42
        + _risk(float(metrics.get("adjusted_avg_word_length", 0.0)), 5.55, 6.9) * 0.28
        + _risk(float(metrics.get("adjusted_long_word_pct", 0.0)), 29.0, 51.0) * 0.30
    )
    punctuation_pattern = (
        _risk(float(metrics.get("semicolons_per_1000", 0.0)), 3.0, 24.0) * 0.36
        + _risk((text.count("—") + text.count("–")) * 1000.0 / max(word_count, 1), 2.0, 15.0) * 0.24
        + punctuation_uniformity * 0.40
    )

    dimensions = {
        "base_style": round(float(v2["score"]), 1),
        "structural_regularity": round(regularity, 1),
        "repetition": round(repetition, 1),
        "template_language": round(template_language, 1),
        "lexical_pattern": round(lexical_pattern, 1),
        "punctuation_pattern": round(punctuation_pattern, 1),
    }
    weights = {
        "base_style": 0.30,
        "structural_regularity": 0.22,
        "repetition": 0.17,
        "template_language": 0.14,
        "lexical_pattern": 0.11,
        "punctuation_pattern": 0.06,
    }
    raw_score = sum(dimensions[name] * weights[name] for name in weights)
    # Very short samples are pulled slightly towards the centre because their
    # surface statistics are unstable; the confidence field exposes this.
    sample_factor = min(word_count / 180.0, 1.0)
    score = raw_score * (0.70 + 0.30 * sample_factor)
    score = round(_clamp(score), 1)

    signals = []
    explanations = {
        "base_style": "Combined wording, sentence, connector and punctuation profile",
        "structural_regularity": "Uniform sentence or paragraph structure",
        "repetition": "Repeated phrases, sentence openings or content words",
        "template_language": "Formulaic transitions, filler language and nominalised phrasing",
        "lexical_pattern": "Low lexical variation or consistently dense vocabulary",
        "punctuation_pattern": "Regular or unusually formal punctuation patterns",
    }
    for name, value in sorted(dimensions.items(), key=lambda item: item[1], reverse=True):
        signals.append({"name": name, "label": explanations[name], "risk": value})

    return {
        "score": score,
        "detection_score": score,
        "ai_style_score": score,
        "style_risk_score": score,
        "classification": _classification(score),
        "confidence": _confidence(word_count, sentence_count),
        "word_count": word_count,
        "sentence_count": sentence_count,
        "paragraph_count": len(paragraphs),
        "dimensions": dimensions,
        "dimension_weights": weights,
        "top_signals": signals[:4],
        "metrics": {
            **metrics,
            "moving_ttr": round(ttr, 4),
            "sentence_length_entropy": round(entropy, 4),
            "formulaic_opener_pct": round(formulaic_density, 4),
            "nominalisations_per_1000": round(nominalisations, 4),
            "passive_hints_per_1000": round(passive_hints, 4),
            "repeated_content_word_pct": round(repeated_word_rate, 4),
        },
        "method": "transparent_style_pattern_ensemble_v3",
        "disclaimer": (
            "Experimental writing-pattern diagnostic. It does not prove who wrote the text, "
            "and it is not a substitute for an external detector or academic review."
        ),
    }


def _passage_candidates(text: str) -> List[str]:
    paragraphs = _paragraphs(text)
    candidates: List[str] = []
    for paragraph in paragraphs:
        if len(_words(paragraph)) <= 180:
            candidates.append(paragraph)
            continue
        sentences = _sentences(paragraph)
        current: List[str] = []
        current_words = 0
        for sentence in sentences:
            count = len(_words(sentence))
            if current and current_words + count > 140:
                candidates.append(" ".join(current))
                current, current_words = [], 0
            current.append(sentence)
            current_words += count
        if current:
            candidates.append(" ".join(current))
    return candidates


def detect_text(text: str, table_mode: bool = False, include_passages: bool = True) -> Dict[str, Any]:
    report = _core_detection(text, table_mode=table_mode)
    if include_passages:
        passages = []
        for index, passage in enumerate(_passage_candidates(text), start=1):
            if len(_words(passage)) < 18:
                continue
            passage_report = _core_detection(passage, table_mode=table_mode)
            passages.append({
                "passage_number": index,
                "score": passage_report["score"],
                "classification": passage_report["classification"],
                "word_count": passage_report["word_count"],
                "preview": passage[:260],
                "top_signal": passage_report["top_signals"][0] if passage_report["top_signals"] else None,
            })
        passages.sort(key=lambda item: item["score"], reverse=True)
        report["highest_risk_passages"] = passages[:10]
    else:
        report["highest_risk_passages"] = []
    return report


def _split_mapping_text(mapping: Mapping[str, Any], chunk_texts: Mapping[int, str]) -> tuple[str, str]:
    prose: List[str] = []
    tables: List[str] = []
    sections_meta = list(mapping.get("sections", []))
    for chunk in mapping.get("chunks", []):
        number = int(chunk["chunk_number"])
        parsed = parse_extract_text(str(chunk_texts.get(number, chunk.get("text", "")) or ""))
        indices = list(chunk.get("section_indices", []))
        for local_index, lines in enumerate(parsed):
            section_type = "paragraph_group"
            if local_index < len(indices):
                global_index = int(indices[local_index])
                if 0 <= global_index < len(sections_meta):
                    section_type = str(sections_meta[global_index].get("section_type", section_type))
            destination = tables if section_type == "table_row" else prose
            destination.extend(str(line) for line in lines if str(line).strip())
    return "\n".join(prose), "\n".join(tables)


def detect_document_mapping(mapping: Mapping[str, Any], chunk_texts: Mapping[int, str]) -> Dict[str, Any]:
    prose_text, table_text = _split_mapping_text(mapping, chunk_texts)
    prose = detect_text(prose_text, table_mode=False, include_passages=True)
    tables = detect_text(table_text, table_mode=True, include_passages=False)
    prose_words = int(prose["word_count"])
    table_words = int(tables["word_count"])
    total_words = prose_words + table_words
    if prose_words and table_words:
        table_weight = min(0.20, table_words / max(total_words, 1))
        prose_weight = 1.0 - table_weight
    elif table_words:
        prose_weight, table_weight = 0.0, 1.0
    else:
        prose_weight, table_weight = 1.0, 0.0
    score = round(prose["score"] * prose_weight + tables["score"] * table_weight, 1)
    confidence = round(prose["confidence"] * prose_weight + tables["confidence"] * table_weight, 1)
    return {
        "score": score,
        "detection_score": score,
        "ai_style_score": score,
        "style_risk_score": score,
        "expected_ai_style_percentage": score,
        "classification": _classification(score),
        "confidence": confidence,
        "word_count": total_words,
        "sentence_count": int(prose["sentence_count"]) + int(tables["sentence_count"]),
        "prose_weight": round(prose_weight, 4),
        "table_weight": round(table_weight, 4),
        "prose": prose,
        "tables": tables,
        "dimensions": prose["dimensions"],
        "top_signals": prose["top_signals"],
        "highest_risk_passages": prose.get("highest_risk_passages", []),
        "method": "transparent_style_pattern_ensemble_v3",
        "disclaimer": prose["disclaimer"],
    }


def detect_docx(path: str | Path) -> Dict[str, Any]:
    doc = Document(str(path))
    parts: List[str] = []
    segment_reports: List[Dict[str, Any]] = []
    paragraph_index = -1
    table_index = -1
    for block in iter_block_items(doc):
        if block.__class__.__name__ == "Paragraph":
            paragraph_index += 1
            text = block.text.strip()
            if not text:
                continue
            parts.append(text)
            if len(_words(text)) >= 18:
                report = _core_detection(text)
                segment_reports.append({
                    "location": f"Paragraph {paragraph_index + 1}",
                    "type": "paragraph",
                    "score": report["score"],
                    "word_count": report["word_count"],
                    "preview": text[:260],
                    "top_signal": report["top_signals"][0] if report["top_signals"] else None,
                })
        else:
            table_index += 1
            table_text = "\n".join(
                cell_text(cell) for row in block.rows for cell in row.cells if cell_text(cell)
            )
            if table_text:
                parts.append(table_text)
                report = _core_detection(table_text, table_mode=True)
                segment_reports.append({
                    "location": f"Table {table_index + 1}",
                    "type": "table",
                    "score": report["score"],
                    "word_count": report["word_count"],
                    "preview": table_text[:260],
                    "top_signal": report["top_signals"][0] if report["top_signals"] else None,
                })
    combined = "\n\n".join(parts)
    report = detect_text(combined, include_passages=False)
    segment_reports.sort(key=lambda item: item["score"], reverse=True)
    report["highest_risk_passages"] = segment_reports[:12]
    report["document"] = {
        "paragraph_count": len(doc.paragraphs),
        "table_count": len(doc.tables),
        "section_count": len(doc.sections),
    }
    return report
