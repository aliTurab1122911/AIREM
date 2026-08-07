from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple

from .docx_pipeline_common import WORD_RE, parse_extract_text

# The legacy seven-pair centroid remains available for audit comparison. The
# primary v14 score is a length-neutral style-risk diagnostic used only after
# factual and structural candidate safeguards have passed.

SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“‘(])")
CONTRACTION_RE = re.compile(
    r"\b(?:[A-Za-z]+(?:n't|'re|'ve|'ll|'d|'m|'s))\b",
    re.I,
)

FUNCTION_WORDS = {
    "a", "an", "the", "and", "or", "but", "if", "because", "while", "although",
    "though", "as", "at", "by", "for", "from", "in", "into", "of", "on", "onto",
    "to", "with", "without", "about", "after", "before", "between", "through", "during",
    "under", "over", "within", "across", "around", "this", "that", "these", "those",
    "it", "its", "they", "their", "them", "he", "she", "his", "her", "we", "our",
    "you", "your", "i", "me", "my", "is", "are", "am", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "can", "could", "may", "might",
    "must", "shall", "should", "will", "would", "not", "no", "so", "than", "then",
    "there", "here", "which", "who", "whom", "whose", "where", "when", "what", "how",
}

FORMAL_CONNECTORS = {
    "therefore", "consequently", "furthermore", "moreover", "nevertheless", "nonetheless",
    "whereas", "hence", "thus", "accordingly", "subsequently", "alternatively", "similarly",
    "rather", "however", "while", "because",
}

# Seven-pair prose centroids. Values are approximate, deliberately rounded, and
# documented so future research can replace them without changing the scoring API.
PROSE_AI = {
    "avg_sentence_words": 17.6,
    "sentence_sd": 7.4,
    "avg_word_length": 6.35,
    "long_word_pct": 37.0,
    "short_word_pct": 34.5,
    "function_word_pct": 32.0,
    "semicolons_per_1000": 6.5,
    "contractions_per_1000": 2.3,
    "formal_connectors_per_1000": 9.0,
    "but_per_1000": 5.5,
}

PROSE_REWRITTEN = {
    "avg_sentence_words": 22.4,
    "sentence_sd": 9.7,
    "avg_word_length": 5.50,
    "long_word_pct": 27.3,
    "short_word_pct": 47.5,
    "function_word_pct": 42.5,
    "semicolons_per_1000": 2.7,
    "contractions_per_1000": 5.2,
    "formal_connectors_per_1000": 3.5,
    "but_per_1000": 7.5,
}

PROSE_WEIGHTS = {
    "avg_sentence_words": 0.12,
    "sentence_sd": 0.08,
    "avg_word_length": 0.16,
    "long_word_pct": 0.13,
    "short_word_pct": 0.13,
    "function_word_pct": 0.16,
    "semicolons_per_1000": 0.07,
    "contractions_per_1000": 0.05,
    "formal_connectors_per_1000": 0.07,
    "but_per_1000": 0.03,
}

# Tables showed a different distribution in the paired samples, especially for
# function words and semicolons. Sentence features receive little weight here.
TABLE_AI = {
    "avg_sentence_words": 11.5,
    "sentence_sd": 6.0,
    "avg_word_length": 6.65,
    "long_word_pct": 40.5,
    "short_word_pct": 28.0,
    "function_word_pct": 18.8,
    "semicolons_per_1000": 33.0,
    "contractions_per_1000": 0.5,
    "formal_connectors_per_1000": 6.0,
    "but_per_1000": 2.0,
}

TABLE_REWRITTEN = {
    "avg_sentence_words": 13.5,
    "sentence_sd": 8.0,
    "avg_word_length": 5.90,
    "long_word_pct": 31.5,
    "short_word_pct": 41.5,
    "function_word_pct": 32.3,
    "semicolons_per_1000": 8.0,
    "contractions_per_1000": 1.5,
    "formal_connectors_per_1000": 2.0,
    "but_per_1000": 3.0,
}

TABLE_WEIGHTS = {
    "avg_sentence_words": 0.03,
    "sentence_sd": 0.02,
    "avg_word_length": 0.18,
    "long_word_pct": 0.16,
    "short_word_pct": 0.16,
    "function_word_pct": 0.20,
    "semicolons_per_1000": 0.15,
    "contractions_per_1000": 0.02,
    "formal_connectors_per_1000": 0.05,
    "but_per_1000": 0.03,
}


def _normalise_word(word: str) -> str:
    return word.lower().strip("'-")


def _sentences(text: str) -> List[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    parts = [part.strip() for part in SENTENCE_RE.split(cleaned) if part.strip()]
    return parts or [cleaned]


def _standard_deviation(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / len(values))


def analyse_style(text: str) -> Dict[str, float | int]:
    words = [_normalise_word(word) for word in WORD_RE.findall(text or "")]
    words = [word for word in words if word]
    word_count = len(words)
    sentence_list = _sentences(text)
    sentence_lengths = [len(WORD_RE.findall(sentence)) for sentence in sentence_list]
    sentence_lengths = [length for length in sentence_lengths if length > 0]

    if not word_count:
        return {
            "word_count": 0,
            "sentence_count": 0,
            "avg_sentence_words": 0.0,
            "sentence_sd": 0.0,
            "avg_word_length": 0.0,
            "long_word_pct": 0.0,
            "short_word_pct": 0.0,
            "function_word_pct": 0.0,
            "semicolons_per_1000": 0.0,
            "contractions_per_1000": 0.0,
            "formal_connectors_per_1000": 0.0,
            "but_per_1000": 0.0,
        }

    denominator = max(word_count, 1)
    counts = Counter(words)
    return {
        "word_count": word_count,
        "sentence_count": len(sentence_lengths),
        "avg_sentence_words": round(sum(sentence_lengths) / max(len(sentence_lengths), 1), 4),
        "sentence_sd": round(_standard_deviation(sentence_lengths), 4),
        "avg_word_length": round(sum(len(word) for word in words) / denominator, 4),
        "long_word_pct": round(sum(len(word) >= 8 for word in words) * 100 / denominator, 4),
        "short_word_pct": round(sum(len(word) <= 4 for word in words) * 100 / denominator, 4),
        "function_word_pct": round(sum(word in FUNCTION_WORDS for word in words) * 100 / denominator, 4),
        "semicolons_per_1000": round((text or "").count(";") * 1000 / denominator, 4),
        "contractions_per_1000": round(len(CONTRACTION_RE.findall(text or "")) * 1000 / denominator, 4),
        "formal_connectors_per_1000": round(sum(counts[word] for word in FORMAL_CONNECTORS) * 1000 / denominator, 4),
        "but_per_1000": round(counts["but"] * 1000 / denominator, 4),
    }


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _ai_position(value: float, ai_value: float, rewritten_value: float) -> float:
    """Return 1 near the AI-source centroid and 0 near the rewritten centroid."""
    span = ai_value - rewritten_value
    if abs(span) < 1e-9:
        return 0.5
    return _clamp((value - rewritten_value) / span)


def score_metrics(
    metrics: Mapping[str, float | int],
    ai_centroid: Mapping[str, float],
    rewritten_centroid: Mapping[str, float],
    weights: Mapping[str, float],
) -> Dict[str, Any]:
    components: Dict[str, Dict[str, float]] = {}
    weighted = 0.0
    weight_total = 0.0
    for feature, weight in weights.items():
        value = float(metrics.get(feature, 0.0))
        position = _ai_position(value, ai_centroid[feature], rewritten_centroid[feature])
        weighted += position * weight
        weight_total += weight
        components[feature] = {
            "value": round(value, 4),
            "ai_centroid": ai_centroid[feature],
            "rewritten_centroid": rewritten_centroid[feature],
            "ai_position": round(position, 4),
            "weight": weight,
        }
    score = 100.0 * weighted / max(weight_total, 1e-9)
    return {"score": round(score, 1), "components": components}


def _confidence(word_count: int, sentence_count: int) -> float:
    """Transparent sample-size indicator, not model confidence."""
    word_factor = min(word_count / 1200.0, 1.0)
    sentence_factor = min(sentence_count / 70.0, 1.0)
    return round(20.0 + 50.0 * word_factor + 30.0 * sentence_factor, 1)


FILLER_PATTERNS: Sequence[re.Pattern[str]] = (
    re.compile(r"\bit is important to note that\b", re.I),
    re.compile(r"\bit should be noted that\b", re.I),
    re.compile(r"\bit can be seen that\b", re.I),
    re.compile(r"\bin order to\b", re.I),
    re.compile(r"\bdue to the fact that\b", re.I),
    re.compile(r"\bfor the purpose of\b", re.I),
    re.compile(r"\bwith regard to\b", re.I),
    re.compile(r"\bin relation to\b", re.I),
    re.compile(r"\bplays? an important role\b", re.I),
    re.compile(r"\bhas the ability to\b", re.I),
    re.compile(r"\bis able to\b", re.I),
)


def _risk(value: float, start: float, full: float) -> float:
    """Return a bounded 0-100 risk once ``value`` exceeds ``start``."""
    if full <= start:
        return 0.0
    return round(100.0 * _clamp((value - start) / (full - start)), 4)


def _sentence_start_repetition(sentence_list: Sequence[str]) -> float:
    if len(sentence_list) < 4:
        return 0.0
    starts: List[str] = []
    for sentence in sentence_list:
        words = [_normalise_word(w) for w in WORD_RE.findall(sentence)]
        words = [w for w in words if w]
        if words:
            starts.append(" ".join(words[:2]))
    if not starts:
        return 0.0
    counts = Counter(starts)
    repeated = sum(count - 1 for count in counts.values() if count > 1)
    return round(repeated * 100 / len(starts), 4)


def _repeated_trigram_pct(words: Sequence[str]) -> float:
    if len(words) < 9:
        return 0.0
    trigrams = [tuple(words[i:i + 3]) for i in range(len(words) - 2)]
    counts = Counter(trigrams)
    repeated = sum(count - 1 for count in counts.values() if count > 1)
    return round(repeated * 100 / max(len(trigrams), 1), 4)


def analyse_style_v2(text: str, table_mode: bool = False) -> Dict[str, float | int]:
    """Length-neutral style-risk features used by Rewriter Engine V2.

    Repeated long technical terms are treated as domain vocabulary rather than
    automatic evidence of artificial style. Sentence length is penalised only at
    extremes or when a multi-sentence passage is unusually uniform; the model no
    longer rewards expansion towards a fixed sentence-length centroid.
    """
    base = analyse_style(text)
    raw_words = [_normalise_word(word) for word in WORD_RE.findall(text or "")]
    words = [word for word in raw_words if word]
    word_count = len(words)
    sentence_list = _sentences(text)
    sentence_lengths = [len(WORD_RE.findall(sentence)) for sentence in sentence_list]
    sentence_lengths = [length for length in sentence_lengths if length > 0]

    if not word_count:
        return {
            **base,
            "adjusted_long_word_pct": 0.0,
            "adjusted_avg_word_length": 0.0,
            "sentence_cv": 0.0,
            "repeated_trigram_pct": 0.0,
            "repeated_sentence_start_pct": 0.0,
            "filler_phrases_per_1000": 0.0,
            "domain_term_count": 0,
        }

    frequencies = Counter(words)
    domain_terms = {
        word for word, count in frequencies.items()
        if len(word) >= 8 and count >= 3 and word not in FORMAL_CONNECTORS
    }
    lexical_words = [word for word in words if word not in domain_terms]
    adjusted_long = (
        sum(len(word) >= 8 for word in lexical_words) * 100 / max(len(lexical_words), 1)
    )
    adjusted_avg_word_length = sum(len(word) for word in lexical_words) / max(len(lexical_words), 1)
    sentence_mean = sum(sentence_lengths) / max(len(sentence_lengths), 1)
    sentence_sd = _standard_deviation(sentence_lengths)
    sentence_cv = sentence_sd / sentence_mean if sentence_mean else 0.0
    filler_count = sum(len(pattern.findall(text or "")) for pattern in FILLER_PATTERNS)

    return {
        **base,
        "adjusted_long_word_pct": round(adjusted_long, 4),
        "adjusted_avg_word_length": round(adjusted_avg_word_length, 4),
        "sentence_cv": round(sentence_cv, 4),
        "repeated_trigram_pct": _repeated_trigram_pct(words),
        "repeated_sentence_start_pct": _sentence_start_repetition(sentence_list),
        "filler_phrases_per_1000": round(filler_count * 1000 / max(word_count, 1), 4),
        "domain_term_count": len(domain_terms),
    }


def score_text_v2(text: str, table_mode: bool = False) -> Dict[str, Any]:
    metrics = analyse_style_v2(text, table_mode=table_mode)
    sentence_count = int(metrics["sentence_count"])
    avg_sentence = float(metrics["avg_sentence_words"])
    sentence_cv = float(metrics["sentence_cv"])

    if table_mode:
        components = {
            "word_length": _risk(float(metrics["adjusted_avg_word_length"]), 5.8, 7.1),
            "long_words": _risk(float(metrics["adjusted_long_word_pct"]), 32.0, 55.0),
            "low_function_words": _risk(19.0 - float(metrics["function_word_pct"]), 0.0, 12.0),
            "semicolons": _risk(float(metrics["semicolons_per_1000"]), 12.0, 55.0),
            "formal_connectors": _risk(float(metrics["formal_connectors_per_1000"]), 5.0, 20.0),
            "repeated_phrases": _risk(float(metrics["repeated_trigram_pct"]), 2.0, 14.0),
            "filler_phrases": _risk(float(metrics["filler_phrases_per_1000"]), 2.0, 12.0),
        }
        weights = {
            "word_length": 0.20,
            "long_words": 0.18,
            "low_function_words": 0.08,
            "semicolons": 0.28,
            "formal_connectors": 0.08,
            "repeated_phrases": 0.08,
            "filler_phrases": 0.10,
        }
    else:
        if avg_sentence < 8:
            sentence_extreme = _risk(8 - avg_sentence, 0.0, 6.0)
        elif avg_sentence > 34:
            sentence_extreme = _risk(avg_sentence, 34.0, 55.0)
        else:
            sentence_extreme = 0.0
        sentence_uniformity = (
            _risk(0.42 - sentence_cv, 0.0, 0.30) if sentence_count >= 4 else 0.0
        )
        components = {
            "word_length": _risk(float(metrics["adjusted_avg_word_length"]), 5.55, 6.85),
            "long_words": _risk(float(metrics["adjusted_long_word_pct"]), 28.0, 50.0),
            "low_function_words": _risk(32.0 - float(metrics["function_word_pct"]), 0.0, 14.0),
            "formal_connectors": _risk(float(metrics["formal_connectors_per_1000"]), 4.0, 18.0),
            "semicolons": _risk(float(metrics["semicolons_per_1000"]), 3.0, 25.0),
            "sentence_uniformity": sentence_uniformity,
            "sentence_extremes": sentence_extreme,
            "repeated_phrases": _risk(float(metrics["repeated_trigram_pct"]), 1.5, 12.0),
            "repeated_starts": _risk(float(metrics["repeated_sentence_start_pct"]), 12.0, 55.0),
            "filler_phrases": _risk(float(metrics["filler_phrases_per_1000"]), 1.5, 10.0),
        }
        weights = {
            "word_length": 0.16,
            "long_words": 0.15,
            "low_function_words": 0.14,
            "formal_connectors": 0.11,
            "semicolons": 0.09,
            "sentence_uniformity": 0.12,
            "sentence_extremes": 0.07,
            "repeated_phrases": 0.08,
            "repeated_starts": 0.04,
            "filler_phrases": 0.04,
        }

    weighted = sum(components[name] * weight for name, weight in weights.items())
    total_weight = sum(weights.values()) or 1.0
    score = round(weighted / total_weight, 1)
    return {
        "score": score,
        "components": {
            name: {"risk": round(value, 4), "weight": weights[name]}
            for name, value in components.items()
        },
        "metrics": metrics,
        "method": "length_neutral_style_risk_v2",
    }


def split_document_text(mapping: Mapping[str, Any], chunk_texts: Mapping[int, str]) -> Tuple[str, str]:
    prose_parts: List[str] = []
    table_parts: List[str] = []

    sections_meta = mapping.get("sections", [])
    for chunk in mapping.get("chunks", []):
        chunk_number = int(chunk["chunk_number"])
        text = str(chunk_texts.get(chunk_number, chunk.get("text", "")) or "")
        parsed = parse_extract_text(text)
        indices = list(chunk.get("section_indices", []))
        for local_index, lines in enumerate(parsed):
            global_index = indices[local_index] if local_index < len(indices) else None
            section_type = "paragraph_group"
            if global_index is not None and 0 <= int(global_index) < len(sections_meta):
                section_type = str(sections_meta[int(global_index)].get("section_type", "paragraph_group"))
            destination = table_parts if section_type == "table_row" else prose_parts
            destination.extend(str(line) for line in lines if str(line).strip())

    return "\n".join(prose_parts), "\n".join(table_parts)


def score_document(mapping: Mapping[str, Any], chunk_texts: Mapping[int, str]) -> Dict[str, Any]:
    prose_text, table_text = split_document_text(mapping, chunk_texts)

    prose_v2 = score_text_v2(prose_text, table_mode=False)
    table_v2 = score_text_v2(table_text, table_mode=True)

    prose_metrics = analyse_style(prose_text)
    table_metrics = analyse_style(table_text)
    prose_legacy = score_metrics(prose_metrics, PROSE_AI, PROSE_REWRITTEN, PROSE_WEIGHTS)
    table_legacy = score_metrics(table_metrics, TABLE_AI, TABLE_REWRITTEN, TABLE_WEIGHTS)

    prose_words = int(prose_metrics["word_count"])
    table_words = int(table_metrics["word_count"])
    total_words = prose_words + table_words
    total_sentences = int(prose_metrics["sentence_count"]) + int(table_metrics["sentence_count"])

    if prose_words and table_words:
        table_weight = min(0.20, table_words / max(total_words, 1))
        prose_weight = 1.0 - table_weight
    elif table_words:
        table_weight, prose_weight = 1.0, 0.0
    else:
        table_weight, prose_weight = 0.0, 1.0

    overall_v2 = prose_v2["score"] * prose_weight + table_v2["score"] * table_weight
    overall_legacy = prose_legacy["score"] * prose_weight + table_legacy["score"] * table_weight
    return {
        "ai_style_score": round(overall_v2, 1),
        "style_risk_score": round(overall_v2, 1),
        "legacy_ai_style_score": round(overall_legacy, 1),
        "expected_ai_style_percentage": round(overall_v2, 1),
        "confidence": _confidence(total_words, total_sentences),
        "word_count": total_words,
        "sentence_count": total_sentences,
        "prose_weight": round(prose_weight, 4),
        "table_weight": round(table_weight, 4),
        "prose": {"metrics": prose_v2["metrics"], "score": prose_v2["score"], "components": prose_v2["components"]},
        "tables": {"metrics": table_v2["metrics"], "score": table_v2["score"], "components": table_v2["components"]},
        "legacy": {
            "score": round(overall_legacy, 1),
            "prose": {"metrics": prose_metrics, **prose_legacy},
            "tables": {"metrics": table_metrics, **table_legacy},
            "method": "seven_pair_local_style_centroid_v1",
        },
        "method": "length_neutral_style_risk_v2",
        "disclaimer": (
            "Internal style-risk diagnostic used to compare safe rewrite candidates. "
            "It is not an authorship probability and is not an external AI-detector result."
        ),
    }


def original_chunk_texts(mapping: Mapping[str, Any]) -> Dict[int, str]:
    return {int(chunk["chunk_number"]): str(chunk.get("text", "")) for chunk in mapping.get("chunks", [])}
