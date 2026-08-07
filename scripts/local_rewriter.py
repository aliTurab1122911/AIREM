from __future__ import annotations

import re
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from .docx_pipeline_common import WORD_RE, parse_extract_text, sections_to_text
from .detection_service import detect_text


# This module is intentionally quality-centred and detector-independent.
# It offers auditable style transformations, preserves protected anchors,
# generates several internal candidates, and keeps only the highest-scoring
# coherent candidate. V14 adds original-based word budgets, constrained compression,
# score-aware ranking and global rollback while retaining factual, structural,
# duplicate and prompt-leak checks.


@dataclass(frozen=True)
class RewriteProfile:
    name: str
    description: str
    strategy: str = "natural"
    use_contractions: bool = False
    simplify_connectors: bool = True
    simplify_phrases: bool = True
    split_long_sentences: bool = True
    max_sentence_words: int = 34
    lexical_decompression: bool = False
    conversational_coordination: bool = False
    rhetorical_framing: bool = False
    preserve_sentence_count: bool = False
    candidate_count: int = 8
    target_ratio: float = 0.98
    min_ratio: float = 0.75
    max_ratio: float = 1.05
    table_min_ratio: float = 0.75
    table_max_ratio: float = 1.03
    table_target_ratio: float = 0.98
    hard_ratio_gate: bool = True
    sentence_count_tolerance: int = 1
    paragraph_overlap: float = 0.68
    table_overlap: float = 0.82
    lexical_intensity: int = 65
    connector_intensity: int = 70
    contraction_intensity: int = 0
    conversational_intensity: int = 0
    framing_intensity: int = 0
    table_intensity: int = 35
    compression_intensity: int = 65
    max_cumulative_ratio: float = 1.05
    min_objective_improvement: float = 0.0
    style_weight: float = 1.0
    length_weight: float = 0.55
    semantic_weight: float = 0.55


PROFILES: Dict[str, RewriteProfile] = {
    "light": RewriteProfile(
        name="light",
        description="Minimal wording changes with a near-original word count.",
        strategy="light",
        split_long_sentences=False,
        max_sentence_words=42,
        target_ratio=1.00,
        min_ratio=0.90,
        max_ratio=1.03,
        table_min_ratio=0.85,
        table_max_ratio=1.02,
        table_target_ratio=1.00,
        paragraph_overlap=0.78,
        table_overlap=0.90,
        lexical_intensity=45,
        connector_intensity=55,
        compression_intensity=40,
        candidate_count=6,
    ),
    "natural": RewriteProfile(
        name="natural",
        description="Natural academic/professional rewrite with a strict global length budget.",
        strategy="natural",
        target_ratio=0.98,
        min_ratio=0.82,
        max_ratio=1.03,
        table_min_ratio=0.78,
        table_max_ratio=1.02,
        table_target_ratio=0.98,
        paragraph_overlap=0.70,
        table_overlap=0.86,
        lexical_intensity=70,
        connector_intensity=80,
        compression_intensity=68,
        candidate_count=12,
    ),
    "rewrite_compress": RewriteProfile(
        name="rewrite_compress",
        description="Rewrite and safely compress redundant wording while preserving facts and structure.",
        strategy="rewrite_compress",
        target_ratio=0.90,
        min_ratio=0.60,
        max_ratio=1.00,
        table_min_ratio=0.72,
        table_max_ratio=0.98,
        table_target_ratio=0.92,
        paragraph_overlap=0.68,
        table_overlap=0.84,
        lexical_intensity=85,
        connector_intensity=90,
        compression_intensity=100,
        candidate_count=16,
        max_cumulative_ratio=1.00,
    ),
    "compress": RewriteProfile(
        name="compress",
        description="Compression-first mode for removing padding and repeated framing.",
        strategy="compress",
        use_contractions=False,
        simplify_connectors=True,
        simplify_phrases=True,
        split_long_sentences=False,
        target_ratio=0.84,
        min_ratio=0.55,
        max_ratio=1.00,
        table_min_ratio=0.68,
        table_max_ratio=0.96,
        table_target_ratio=0.88,
        paragraph_overlap=0.68,
        table_overlap=0.84,
        lexical_intensity=95,
        connector_intensity=95,
        compression_intensity=100,
        candidate_count=14,
        max_cumulative_ratio=1.00,
    ),
    "plain": RewriteProfile(
        name="plain",
        description="Plain-English rewrite with moderate compression and limited contractions.",
        strategy="plain",
        use_contractions=True,
        contraction_intensity=20,
        max_sentence_words=30,
        target_ratio=0.95,
        min_ratio=0.75,
        max_ratio=1.02,
        table_min_ratio=0.75,
        table_max_ratio=1.01,
        table_target_ratio=0.96,
        paragraph_overlap=0.68,
        table_overlap=0.85,
        lexical_intensity=80,
        connector_intensity=85,
        compression_intensity=82,
        candidate_count=12,
    ),
    "expanded": RewriteProfile(
        name="expanded",
        description="Intentional expansion. Use only when a longer output is explicitly required.",
        strategy="intentional_expansion",
        use_contractions=True,
        simplify_connectors=False,
        simplify_phrases=False,
        split_long_sentences=False,
        max_sentence_words=70,
        lexical_decompression=True,
        conversational_coordination=True,
        rhetorical_framing=False,
        preserve_sentence_count=True,
        candidate_count=14,
        target_ratio=1.12,
        min_ratio=1.00,
        max_ratio=1.20,
        table_min_ratio=0.92,
        table_max_ratio=1.12,
        table_target_ratio=1.04,
        hard_ratio_gate=True,
        sentence_count_tolerance=1,
        paragraph_overlap=0.72,
        table_overlap=0.86,
        lexical_intensity=60,
        connector_intensity=40,
        contraction_intensity=20,
        conversational_intensity=35,
        framing_intensity=0,
        table_intensity=25,
        compression_intensity=20,
        max_cumulative_ratio=1.25,
    ),
}

# Backward-compatible API names used by older saved jobs and clients.
PROFILES["conservative"] = RewriteProfile(**{**asdict(PROFILES["light"]), "name": "conservative"})
PROFILES["balanced"] = RewriteProfile(**{**asdict(PROFILES["natural"]), "name": "balanced"})


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    try:
        parsed = int(round(float(value)))
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def build_manual_profile(settings: Dict[str, Any] | None = None) -> RewriteProfile:
    """Build a constrained manual profile for Rewriter Engine V2."""
    raw = settings or {}
    if "target_change_percent" in raw:
        target_change = _clamp_int(raw.get("target_change_percent"), -35, 20, -2)
    else:
        # Compatibility with v13 controls. Old expansion values are capped so a
        # stale browser setting cannot recreate runaway repeated expansion.
        old_expansion = _clamp_int(raw.get("expansion_percent"), 0, 60, 0)
        target_change = min(old_expansion, 5)
    tolerance = _clamp_int(raw.get("length_tolerance", raw.get("expansion_tolerance")), 2, 20, 7)
    target_ratio = 1.0 + target_change / 100.0
    min_ratio = max(0.60, target_ratio - tolerance / 100.0)
    max_ratio = min(1.25, target_ratio + tolerance / 100.0)

    table_intensity = _clamp_int(raw.get("table_intensity"), 0, 100, 30)
    table_target_ratio = 1.0 + (target_ratio - 1.0) * table_intensity / 100.0
    lexical_intensity = _clamp_int(raw.get("lexical_intensity"), 0, 100, 70)
    connector_intensity = _clamp_int(raw.get("connector_intensity"), 0, 100, 70)
    contraction_intensity = _clamp_int(raw.get("contraction_intensity"), 0, 100, 0)
    compression_intensity = _clamp_int(raw.get("compression_intensity"), 0, 100, 70)
    candidate_count = _clamp_int(raw.get("candidate_count"), 2, 32, 12)
    max_sentence_words = _clamp_int(raw.get("max_sentence_words"), 20, 80, 34)
    preservation_percent = _clamp_int(raw.get("content_preservation"), 60, 100, 72)
    table_preservation_percent = _clamp_int(raw.get("table_preservation"), 72, 100, 86)
    max_cumulative_percent = _clamp_int(raw.get("max_cumulative_increase"), 0, 25, 5)

    return RewriteProfile(
        name="manual",
        description="User-controlled score-and-length profile with fixed factual safeguards.",
        strategy="manual",
        use_contractions=contraction_intensity > 0,
        simplify_connectors=connector_intensity > 0,
        simplify_phrases=True,
        split_long_sentences=bool(raw.get("split_long_sentences", True)),
        max_sentence_words=max_sentence_words,
        lexical_decompression=target_change > 3,
        conversational_coordination=False,
        rhetorical_framing=False,
        preserve_sentence_count=bool(raw.get("preserve_sentence_count", False)),
        candidate_count=candidate_count,
        target_ratio=target_ratio,
        min_ratio=min_ratio,
        max_ratio=max_ratio,
        table_min_ratio=max(0.65, table_target_ratio - tolerance / 100.0),
        table_max_ratio=min(1.20, table_target_ratio + tolerance / 100.0),
        table_target_ratio=table_target_ratio,
        hard_ratio_gate=True,
        sentence_count_tolerance=_clamp_int(raw.get("sentence_count_tolerance"), 0, 3, 1),
        paragraph_overlap=preservation_percent / 100.0,
        table_overlap=table_preservation_percent / 100.0,
        lexical_intensity=lexical_intensity,
        connector_intensity=connector_intensity,
        contraction_intensity=contraction_intensity,
        conversational_intensity=0,
        framing_intensity=0,
        table_intensity=table_intensity,
        compression_intensity=compression_intensity,
        max_cumulative_ratio=1.0 + max_cumulative_percent / 100.0,
    )


def serialise_manual_profile(profile: RewriteProfile) -> Dict[str, Any]:
    data = asdict(profile)
    data["target_change_percent"] = round((profile.target_ratio - 1.0) * 100)
    data["max_cumulative_increase"] = round((profile.max_cumulative_ratio - 1.0) * 100)
    data["content_preservation"] = round(profile.paragraph_overlap * 100)
    data["table_preservation"] = round(profile.table_overlap * 100)
    return data


def get_profile(name: str, override: RewriteProfile | None = None) -> RewriteProfile:
    return override or PROFILES.get(name, PROFILES["natural"])


# Protected spans are restored byte-for-byte after editing.
PROTECTED_PATTERNS: Sequence[re.Pattern[str]] = (
    re.compile(r"https?://\S+", re.I),
    re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b"),
    re.compile(r"\([^()]*\b(?:18|19|20)\d{2}[a-z]?\b[^()]*\)"),
    re.compile(r"\[(?:18|19|20)\d{2}[a-z]?\]"),
    re.compile(r"(?<!\w)(?:£|\$|€|PKR|USD|GBP|EUR|RM)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|m|bn))?(?!\w)", re.I),
    re.compile(r"\b\d+(?:\.\d+)?\s?%(?!\w)"),
    re.compile(r"\b\d+(?:\.\d+)?\s?(?:per cent|percent)\b", re.I),
    re.compile(r"\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:18|19|20)\d{2}\b", re.I),
    re.compile(r"\b(?:18|19|20)\d{2}\b"),
    re.compile(r"\b\d+(?:\.\d+)?\s?[×x]\s?\d+(?:\.\d+)?(?:\s?=\s?\d+(?:\.\d+)?)?\b"),
    re.compile(r"\b\d+(?:\.\d+)?\b"),
)


# Conservative phrase changes: these reduce unnecessary formality without
# changing the proposition or adding new content.
PHRASE_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bin order to\b", re.I), "to"),
    (re.compile(r"\bdue to the fact that\b", re.I), "because"),
    (re.compile(r"\bfor the purpose of\b", re.I), "to"),
    (re.compile(r"\bwith regard to\b", re.I), "about"),
    (re.compile(r"\bin relation to\b", re.I), "about"),
    (re.compile(r"\ba number of\b", re.I), "several"),
    (re.compile(r"\bhas the ability to\b", re.I), "can"),
    (re.compile(r"\bis able to\b", re.I), "can"),
    (re.compile(r"\bis capable of\b", re.I), "can"),
    (re.compile(r"\bare able to\b", re.I), "can"),
    (re.compile(r"\butilise\b", re.I), "use"),
    (re.compile(r"\butilises\b", re.I), "uses"),
    (re.compile(r"\butilised\b", re.I), "used"),
    (re.compile(r"\butilising\b", re.I), "using"),
    (re.compile(r"\bdemonstrates\b", re.I), "shows"),
    (re.compile(r"\bdemonstrate\b", re.I), "show"),
    (re.compile(r"\bcommence\b", re.I), "begin"),
    (re.compile(r"\bcommences\b", re.I), "begins"),
    (re.compile(r"\bcommenced\b", re.I), "began"),
    (re.compile(r"\bprior to\b", re.I), "before"),
    (re.compile(r"\bsubsequent to\b", re.I), "after"),
    (re.compile(r"\bthe majority of\b", re.I), "most"),
    (re.compile(r"\bapproximately\b", re.I), "about"),
)


# Meaning-preserving compression rules. They remove padding and nominalised
# phrasing without deleting propositions, citations, figures, or list items.
COMPRESSION_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bis capable of providing an explanation of\b", re.I), "can explain"),
    (re.compile(r"\bare capable of providing an explanation of\b", re.I), "can explain"),
    (re.compile(r"\bit is important to note that\s*", re.I), ""),
    (re.compile(r"\bit should be noted that\s*", re.I), ""),
    (re.compile(r"\bit can be seen that\s*", re.I), ""),
    (re.compile(r"\bthe fact that\b", re.I), "that"),
    (re.compile(r"\bin order to\b", re.I), "to"),
    (re.compile(r"\bfor the purpose of\b", re.I), "to"),
    (re.compile(r"\bwith the aim of\b", re.I), "to"),
    (re.compile(r"\bdue to the fact that\b", re.I), "because"),
    (re.compile(r"\bin the event that\b", re.I), "if"),
    (re.compile(r"\bat this point in time\b", re.I), "now"),
    (re.compile(r"\bwith regard to\b", re.I), "about"),
    (re.compile(r"\bin relation to\b", re.I), "about"),
    (re.compile(r"\bon the basis of\b", re.I), "from"),
    (re.compile(r"\bhas the ability to\b", re.I), "can"),
    (re.compile(r"\bhas the potential to\b", re.I), "can"),
    (re.compile(r"\bis able to\b", re.I), "can"),
    (re.compile(r"\bis capable of\b", re.I), "can"),
    (re.compile(r"\bare able to\b", re.I), "can"),
    (re.compile(r"\bmake use of\b", re.I), "use"),
    (re.compile(r"\bmakes use of\b", re.I), "uses"),
    (re.compile(r"\bmade use of\b", re.I), "used"),
    (re.compile(r"\bprovide an explanation of\b", re.I), "explain"),
    (re.compile(r"\bproviding an explanation of\b", re.I), "explaining"),
    (re.compile(r"\bprovides an explanation of\b", re.I), "explains"),
    (re.compile(r"\bconduct an analysis of\b", re.I), "analyse"),
    (re.compile(r"\bconducted an analysis of\b", re.I), "analysed"),
    (re.compile(r"\bperform an evaluation of\b", re.I), "evaluate"),
    (re.compile(r"\bcarried out an evaluation of\b", re.I), "evaluated"),
    (re.compile(r"\btake into consideration\b", re.I), "consider"),
    (re.compile(r"\btakes into consideration\b", re.I), "considers"),
    (re.compile(r"\ba large number of\b", re.I), "many"),
    (re.compile(r"\bthe majority of\b", re.I), "most"),
    (re.compile(r"\bwas found to be\b", re.I), "was"),
    (re.compile(r"\bwere found to be\b", re.I), "were"),
    (re.compile(r"\bthe results of the analysis (?:showed|demonstrated) that\b", re.I), "the analysis showed that"),
    (re.compile(r"\bplays an important role in\b", re.I), "supports"),
    (re.compile(r"\bplay an important role in\b", re.I), "support"),
)


CONNECTOR_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"^\s*Furthermore,\s*", re.I), "Also, "),
    (re.compile(r"^\s*Moreover,\s*", re.I), "Also, "),
    (re.compile(r"^\s*Nevertheless,\s*", re.I), "Still, "),
    (re.compile(r"^\s*Consequently,\s*", re.I), "As a result, "),
    (re.compile(r"^\s*Therefore,\s*", re.I), "As a result, "),
)


# Expanded-style rules intentionally convert compact wording into common
# multiword constructions. Rules are applied selectively, not all at once.
DECOMPRESSION_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"\buses\b", re.I), "makes use of"),
    (re.compile(r"\bto use\b", re.I), "to make use of"),
    (re.compile(r"\busing\b", re.I), "making use of"),
    (re.compile(r"\bcreates\b", re.I), "helps to create"),
    (re.compile(r"(?<!helps )\bto create\b", re.I), "to help create"),
    (re.compile(r"\bimproves\b", re.I), "helps to improve"),
    (re.compile(r"(?<!helps )\bto improve\b", re.I), "to help improve"),
    (re.compile(r"\breduces\b", re.I), "helps to reduce"),
    (re.compile(r"(?<!helps )\bto reduce\b", re.I), "to help reduce"),
    (re.compile(r"\bsupports\b", re.I), "helps to support"),
    (re.compile(r"(?<!helps )\bto support\b", re.I), "to help support"),
    (re.compile(r"\bdepends on\b", re.I), "is dependent on"),
    (re.compile(r"\bbased on\b", re.I), "built on the basis of"),
    (re.compile(r"\bfocuses on\b", re.I), "places its main focus on"),
    (re.compile(r"\bshows that\b", re.I), "makes it clear that"),
    (re.compile(r"\bmeans that\b", re.I), "can be understood to mean that"),
    (re.compile(r"\bbecause\b", re.I), "because of the fact that"),
    (re.compile(r"\bthrough\b", re.I), "by means of"),
    (re.compile(r"\brather than\b", re.I), "instead of simply"),
    (re.compile(r"\bin practice\b", re.I), "when this is applied in practice"),
    (re.compile(r"\bfor example\b", re.I), "as a practical example"),
    (re.compile(r"\brequires\b", re.I), "calls for"),
    (re.compile(r"\brequire\b", re.I), "call for"),
    (re.compile(r"\ballows\b", re.I), "makes it possible for"),
    (re.compile(r"\brefers to\b", re.I), "can be understood as"),
    (re.compile(r"\baims to\b", re.I), "has the aim of trying to"),
    (re.compile(r"\bneeds to\b", re.I), "has a need to"),
    (re.compile(r"\bis important\b", re.I), "plays an important role"),
    (re.compile(r"\bare important\b", re.I), "play an important role"),
    (re.compile(r"\bis necessary\b", re.I), "is needed"),
    (re.compile(r"\bare necessary\b", re.I), "are needed"),
    (re.compile(r"\bprovides\b", re.I), "helps to provide"),
    (re.compile(r"\bprotects\b", re.I), "helps to protect"),
    (re.compile(r"\bdevelops\b", re.I), "helps to develop"),
    (re.compile(r"\bchanges\b", re.I), "brings about changes in"),
    (re.compile(r"\bmeasures\b", re.I), "makes it possible to measure"),
)


CONVERSATIONAL_CONNECTOR_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"^\s*However,\s*", re.I), "But at the same time, "),
    (re.compile(r"^\s*Therefore,\s*", re.I), "Because of this, "),
    (re.compile(r"^\s*Consequently,\s*", re.I), "As a result of this, "),
    (re.compile(r"^\s*Moreover,\s*", re.I), "And in addition, "),
    (re.compile(r"^\s*Furthermore,\s*", re.I), "And in addition, "),
    (re.compile(r"^\s*Nevertheless,\s*", re.I), "But even so, "),
)


CONTRACTION_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bit is\b", re.I), "it's"),
    (re.compile(r"\bthat is\b", re.I), "that's"),
    (re.compile(r"\bthere is\b", re.I), "there's"),
    (re.compile(r"\bdo not\b", re.I), "don't"),
    (re.compile(r"\bdoes not\b", re.I), "doesn't"),
    (re.compile(r"\bdid not\b", re.I), "didn't"),
    (re.compile(r"\bcannot\b", re.I), "can't"),
    (re.compile(r"\bwill not\b", re.I), "won't"),
    (re.compile(r"\bshould not\b", re.I), "shouldn't"),
    (re.compile(r"\bwould not\b", re.I), "wouldn't"),
    (re.compile(r"\bare not\b", re.I), "aren't"),
    (re.compile(r"\bis not\b", re.I), "isn't"),
)


SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“])")
CITATION_LIKE_RE = re.compile(r"\b(?:Act|Regulations|Code|Court|Tribunal|GDPR|ISO|UK|EU|Ltd|LLP|CIC)\b")
PROMPT_LEAK_RE = re.compile(
    r"\b(?:rewrite|paraphrase|humanize|humanise|output the following|output:|answer the following|"
    r"why not take a look|what is it that you|what area of|number (?:one|two|three|four|five) should|"
    r"use the word|explain the need for)\b",
    re.I,
)

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "because", "been", "being", "but", "by",
    "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
    "here", "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "may",
    "might", "more", "most", "not", "of", "on", "or", "our", "ours", "she", "should", "so",
    "such", "than", "that", "the", "their", "theirs", "them", "then", "there", "these", "they",
    "this", "those", "through", "to", "too", "under", "up", "us", "was", "we", "were", "what",
    "when", "where", "which", "while", "who", "will", "with", "would", "you", "your", "yours", "order",
}

FRAMING_PREFIXES = (
    "In practical terms, ",
    "From this perspective, ",
    "In this setting, ",
    "More specifically, ",
    "At the same time, ",
    "In operational terms, ",
    "When considered in context, ",
    "From a broader point of view, ",
    "In relation to the wider discussion, ",
    "As part of this analysis, ",
)

FRAMING_SUFFIXES = (
    " when considered in practice",
    " in the wider context",
    " as part of the broader process",
    " within this area of analysis",
    " when viewed from this perspective",
    " in relation to the issue being discussed",
)

TABLE_HEADER_TEMPLATES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"^(?:primary )?purpose$", re.I), "The primary purpose is {value}."),
    (re.compile(r"resource(?: logic|s)?$", re.I), "The main resources include {value}."),
    (re.compile(r"(?:main )?success measures?$", re.I), "The main success measures include {value}."),
    (re.compile(r"illustrative example$", re.I), "An illustrative example is {value}."),
    (re.compile(r"practical meaning$", re.I), "In practice, this means {value}."),
    (re.compile(r"critical evaluation$", re.I), "The critical evaluation is that {value}."),
    (re.compile(r"core work$", re.I), "The core work includes {value}."),
    (re.compile(r"decision output$", re.I), "The expected decision output is {value}."),
    (re.compile(r"main benefits?$", re.I), "The main benefits include {value}."),
    (re.compile(r"principal risks?$", re.I), "The principal risks include {value}."),
    (re.compile(r"recommended design$", re.I), "The recommended design is {value}."),
    (re.compile(r"strengths?$", re.I), "The main strengths include {value}."),
    (re.compile(r"limitations?$", re.I), "The main limitations include {value}."),
    (re.compile(r"best use$", re.I), "The best use is {value}."),
    (re.compile(r"advantages?$", re.I), "The main advantages include {value}."),
    (re.compile(r"disadvantages?$", re.I), "The main disadvantages include {value}."),
    (re.compile(r"recommended action$", re.I), "The recommended action is to {value}."),
    (re.compile(r"implication(?: for .+)?$", re.I), "The practical implication is {value}."),
)


@dataclass
class LineRewriteResult:
    original: str
    rewritten: str
    changed: bool
    accepted: bool
    mode: str
    reasons: List[str]
    metrics: Dict[str, Any]


def list_profiles() -> List[Dict[str, Any]]:
    return [asdict(profile) for profile in PROFILES.values()]


def _word_count(text: str) -> int:
    return len(WORD_RE.findall(text or ""))


def _normalise_space(text: str) -> str:
    text = str(text or "").replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([.!?])(?=[A-Z])", r"\1 ", text)
    return text


MODAL_GERUND_REPAIRS: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"\b(can|may|must|should|will|could|would) providing\b", re.I), r"\1 provide"),
    (re.compile(r"\b(can|may|must|should|will|could|would) explaining\b", re.I), r"\1 explain"),
    (re.compile(r"\b(can|may|must|should|will|could|would) using\b", re.I), r"\1 use"),
    (re.compile(r"\b(can|may|must|should|will|could|would) evaluating\b", re.I), r"\1 evaluate"),
    (re.compile(r"\b(can|may|must|should|will|could|would) analysing\b", re.I), r"\1 analyse"),
)


def _repair_local_grammar(text: str) -> str:
    return _apply_rules(text, MODAL_GERUND_REPAIRS)


def _protect(text: str) -> Tuple[str, Dict[str, str]]:
    protected: Dict[str, str] = {}
    output = text
    counter = 0

    for pattern in PROTECTED_PATTERNS:
        pos = 0
        pieces: List[str] = []
        for match in pattern.finditer(output):
            if match.start() < pos:
                continue
            n = counter
            letters = ""
            while True:
                letters = chr(ord("A") + (n % 26)) + letters
                n = n // 26 - 1
                if n < 0:
                    break
            token = f"ZXQPROTECTED{letters}QXZ"
            protected[token] = match.group(0)
            counter += 1
            pieces.append(output[pos:match.start()])
            pieces.append(token)
            pos = match.end()
        if pieces:
            pieces.append(output[pos:])
            output = "".join(pieces)
    return output, protected


def _restore(text: str, protected: Dict[str, str]) -> str:
    restored = text
    for token, value in protected.items():
        restored = restored.replace(token, value)
    return restored


def _anchor_multiset(text: str) -> Counter[str]:
    anchors: List[str] = []
    remaining = text
    for pattern in PROTECTED_PATTERNS:
        matches = list(pattern.finditer(remaining))
        if not matches:
            continue
        anchors.extend(m.group(0) for m in matches)
        chars = list(remaining)
        for match in matches:
            for index in range(match.start(), match.end()):
                chars[index] = " "
        remaining = "".join(chars)
    return Counter(anchors)


def _apply_rules(text: str, rules: Iterable[Tuple[re.Pattern[str], str]]) -> str:
    result = text
    for pattern, replacement in rules:
        def repl(match: re.Match[str]) -> str:
            source = match.group(0)
            value = replacement
            if source.isupper():
                return value.upper()
            if source[:1].isupper() and value[:1].isalpha():
                return value[:1].upper() + value[1:]
            return value
        result = pattern.sub(repl, result)
    return result


def _apply_limited_rules(
    text: str,
    rules: Sequence[Tuple[re.Pattern[str], str]],
    limit: int,
    start_offset: int = 0,
) -> str:
    result = text
    applied = 0
    if not rules or limit <= 0:
        return result
    ordered = list(rules[start_offset:]) + list(rules[:start_offset])
    for pattern, replacement in ordered:
        if applied >= limit:
            break
        if not pattern.search(result):
            continue
        result = _apply_rules(result, ((pattern, replacement),))
        applied += 1
    return result


def _capitalise_sentence_start(text: str) -> str:
    for index, char in enumerate(text):
        if char.isalpha():
            return text[:index] + char.upper() + text[index + 1:]
    return text


def _split_long_sentence(sentence: str, max_words: int) -> str:
    if _word_count(sentence) <= max_words:
        return sentence

    for delimiter in ("; ", ": "):
        if delimiter in sentence:
            left, right = sentence.split(delimiter, 1)
            if _word_count(left) >= 8 and _word_count(right) >= 6:
                return left.rstrip(" ,;:") + ". " + _capitalise_sentence_start(right.strip())

    for marker in (", but ", ", however "):
        lower = sentence.lower()
        idx = lower.find(marker)
        if idx > 0:
            left = sentence[:idx]
            right = sentence[idx + len(marker):]
            if _word_count(left) >= 10 and _word_count(right) >= 6:
                prefix = "But " if marker == ", but " else "However, "
                return left.rstrip(" ,") + ". " + prefix + right.strip()
    return sentence


def _replace_terminal(sentence: str, suffix: str) -> str:
    match = re.search(r"([.!?])$", sentence)
    if match:
        return sentence[:-1].rstrip() + suffix + match.group(1)
    return sentence.rstrip() + suffix


def _prefix_sentence(prefix: str, sentence: str) -> str:
    # Lowercase a normal sentence-initial common word after a framing comma,
    # but preserve likely names, acronyms, possessives, citations and multiword
    # proper nouns.
    match = re.match(r"^([A-Z][A-Za-z'-]*)(.*)$", sentence)
    if not match:
        return prefix + sentence
    first, rest = match.groups()
    next_word = re.match(r"^\s+([A-Z][A-Za-z'-]*)", rest)
    likely_proper = (
        (len(first) > 1 and first.isupper())
        or bool(re.fullmatch(r"[A-Z]{2,}s?", first))
        or first.endswith("'s")
        or rest.lstrip().startswith("(")
        or (next_word is not None and next_word.group(1) not in {"The", "This", "A", "An"})
        or first.startswith("ZXQPROTECTED")
    )
    if not likely_proper:
        sentence = first[:1].lower() + first[1:] + rest
    return prefix + sentence


def _split_semicolon_candidate(sentence: str) -> str:
    if "; " not in sentence:
        return sentence
    left, right = sentence.split("; ", 1)
    if _word_count(left) < 5 or _word_count(right) < 4:
        return sentence
    return left.rstrip(" ,;:") + ". " + _capitalise_sentence_start(right.strip())


def _sentence_variants(sentence: str, profile: RewriteProfile, sentence_index: int, table_mode: bool) -> List[str]:
    """Generate compact, natural and (only when requested) expanded candidates."""
    variants: List[str] = [sentence]
    base = sentence

    if profile.simplify_connectors and profile.connector_intensity > 0:
        connector_limit = max(1, round(len(CONNECTOR_RULES) * profile.connector_intensity / 100))
        base = _apply_limited_rules(
            base,
            CONNECTOR_RULES,
            limit=connector_limit,
            start_offset=sentence_index % len(CONNECTOR_RULES),
        )
    if profile.simplify_phrases:
        phrase_limit = max(1, round(len(PHRASE_RULES) * max(profile.lexical_intensity, 20) / 100))
        base = _apply_limited_rules(
            base,
            PHRASE_RULES,
            limit=phrase_limit,
            start_offset=sentence_index % len(PHRASE_RULES),
        )
    if profile.use_contractions and profile.contraction_intensity > 0 and not CITATION_LIKE_RE.search(base):
        contraction_limit = max(1, round(len(CONTRACTION_RULES) * profile.contraction_intensity / 100))
        base = _apply_limited_rules(
            base,
            CONTRACTION_RULES,
            limit=contraction_limit,
            start_offset=sentence_index % len(CONTRACTION_RULES),
        )
    if profile.split_long_sentences:
        base = _split_long_sentence(base, profile.max_sentence_words)

    variants.append(base)
    variants.append(_split_semicolon_candidate(base))

    compression_max = 2 if table_mode else 7
    compression_limit = max(0, round(compression_max * profile.compression_intensity / 100))
    for count in range(1, compression_limit + 1):
        compact = _apply_limited_rules(
            base,
            COMPRESSION_RULES,
            limit=count,
            start_offset=0,
        )
        variants.append(compact)
        variants.append(_split_semicolon_candidate(compact))

    if profile.lexical_decompression and profile.lexical_intensity > 0:
        absolute_max = 2 if table_mode else 4
        rule_limit_max = max(1, round(absolute_max * profile.lexical_intensity / 100))
        for count in range(1, rule_limit_max + 1):
            variants.append(
                _apply_limited_rules(
                    base,
                    DECOMPRESSION_RULES,
                    limit=count,
                    start_offset=(sentence_index + count - 1) % len(DECOMPRESSION_RULES),
                )
            )

        if profile.conversational_coordination and profile.conversational_intensity > 0 and not table_mode:
            conversational_limit = max(
                1,
                round(len(CONVERSATIONAL_CONNECTOR_RULES) * profile.conversational_intensity / 100),
            )
            conversational = _apply_limited_rules(
                base,
                CONVERSATIONAL_CONNECTOR_RULES,
                limit=conversational_limit,
                start_offset=sentence_index % len(CONVERSATIONAL_CONNECTOR_RULES),
            )
            variants.append(conversational)

    unique: List[str] = []
    seen = set()
    for item in variants:
        normal = _normalise_space(item)
        if normal and normal not in seen:
            seen.add(normal)
            unique.append(normal)
    return unique[: max(profile.candidate_count, 2) * 3]


CANONICAL_TOKENS = {
    "utilise": "use", "utilises": "use", "utilised": "use", "utilising": "use",
    "uses": "use", "used": "use", "using": "use",
    "capable": "can", "ability": "can",
    "explanation": "explain", "explains": "explain", "explained": "explain", "explaining": "explain",
    "provides": "provide", "provided": "provide", "providing": "provide",
    "demonstrates": "show", "demonstrated": "show", "shows": "show", "showed": "show",
    "majority": "most", "approximately": "about",
    "evaluation": "evaluate", "evaluated": "evaluate", "evaluating": "evaluate",
    "analysis": "analyse", "analysed": "analyse", "analyzing": "analyse", "analysing": "analyse",
}


def _stem_token(token: str) -> str:
    word = token.lower().strip("'-")
    word = CANONICAL_TOKENS.get(word, word)
    for suffix in ("isation", "ization", "ational", "fulness", "iveness", "ments", "ment", "ingly", "edly", "ing", "ies", "ied", "ed", "es", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    return word


def _content_tokens(text: str) -> set[str]:
    tokens = set()
    for raw in WORD_RE.findall(text or ""):
        token = _stem_token(raw)
        if len(token) < 3 or token in STOPWORDS or token.startswith("zxqprotected"):
            continue
        tokens.add(token)
    return tokens


def _content_overlap(original: str, candidate: str) -> float:
    source = _content_tokens(original)
    if not source:
        return 1.0
    target = _content_tokens(candidate)
    return len(source & target) / len(source)


def _sentence_count(text: str) -> int:
    if not text.strip():
        return 0
    return len(SENTENCE_RE.split(text.strip()))


def _candidate_cost(
    source: str,
    candidate: str,
    profile: RewriteProfile,
    table_mode: bool,
    baseline_original: str | None = None,
) -> Tuple[float, Dict[str, float]]:
    """Return a lower-is-better score-and-length objective."""
    baseline = baseline_original or source
    baseline_words = max(_word_count(baseline), 1)
    ratio = _word_count(candidate) / baseline_words
    target = profile.table_target_ratio if table_mode else profile.target_ratio
    style_score = float(detect_text(candidate, table_mode=table_mode, include_passages=False)["score"])
    overlap = _content_overlap(source, candidate)

    length_deviation = abs(ratio - target) * 100.0
    local_scale = min(1.0, max(0.12, baseline_words / 80.0))
    hard_excess = max(0.0, ratio - profile.max_cumulative_ratio) * 1000.0
    semantic_loss = max(0.0, 1.0 - overlap) * 100.0
    growth_penalty = max(0.0, ratio - 1.0) * (70.0 if target <= 1.0 else 0.0)
    unchanged_penalty = 0.35 if candidate == source and style_score > 8.0 else 0.0
    source_padding = sum(len(pattern.findall(source)) for pattern, _ in COMPRESSION_RULES)
    candidate_padding = sum(len(pattern.findall(candidate)) for pattern, _ in COMPRESSION_RULES)
    compression_gain = max(0, source_padding - candidate_padding)
    semicolon_gain = max(0, source.count(";") - candidate.count(";"))
    simplification_reward = compression_gain * 4.0 + semicolon_gain * 2.0
    style_scale = min(1.0, max(0.20, baseline_words / 60.0))

    cost = (
        style_score * profile.style_weight * style_scale
        + length_deviation * profile.length_weight * local_scale
        + semantic_loss * profile.semantic_weight
        + hard_excess
        + growth_penalty
        + unchanged_penalty
        - simplification_reward
    )
    return cost, {
        "style_score": round(style_score, 4),
        "baseline_word_ratio": round(ratio, 4),
        "length_deviation": round(length_deviation, 4),
        "semantic_overlap": round(overlap, 4),
        "hard_excess_penalty": round(hard_excess, 4),
        "growth_penalty": round(growth_penalty, 4),
        "simplification_reward": round(simplification_reward, 4),
        "objective_cost": round(cost, 4),
    }


def _choose_sentence_candidate(sentence: str, profile: RewriteProfile, sentence_index: int, table_mode: bool) -> str:
    variants = _sentence_variants(sentence, profile, sentence_index, table_mode)
    source_words = max(_word_count(sentence), 1)
    minimum_overlap = max(0.78 if table_mode else 0.62, (profile.table_overlap if table_mode else profile.paragraph_overlap) - 0.08)
    safe: List[str] = []
    for variant in variants:
        ratio = _word_count(variant) / source_words
        # Sentence-level bounds are intentionally wider than final line bounds.
        local_min = max(0.55, (profile.table_min_ratio if table_mode else profile.min_ratio) - 0.15)
        local_max = min(1.35, (profile.table_max_ratio if table_mode else profile.max_ratio) + 0.12)
        if local_min <= ratio <= local_max and _content_overlap(sentence, variant) >= minimum_overlap:
            if not PROMPT_LEAK_RE.search(variant) or PROMPT_LEAK_RE.search(sentence):
                safe.append(variant)
    if sentence not in safe:
        safe.append(sentence)
    return min(
        safe,
        key=lambda item: _candidate_cost(sentence, item, profile, table_mode, baseline_original=sentence)[0],
    )


def _rewrite_sentences(text: str, profile: RewriteProfile, table_mode: bool = False) -> str:
    sentences = SENTENCE_RE.split(text)
    rewritten: List[str] = []
    for index, sentence in enumerate(sentences):
        rewritten.append(_choose_sentence_candidate(sentence, profile, index, table_mode))
    return " ".join(rewritten)


def _sentence_key(sentence: str) -> set[str]:
    return set(re.sub(r"[^a-z0-9]+", " ", sentence.lower()).split())


def _dedupe_adjacent_sentences(text: str) -> str:
    sentences = SENTENCE_RE.split(text)
    kept: List[str] = []
    previous_tokens: set[str] = set()
    for sentence in sentences:
        tokens = _sentence_key(sentence)
        if tokens and previous_tokens:
            union = tokens | previous_tokens
            similarity = len(tokens & previous_tokens) / max(len(union), 1)
            if similarity >= 0.86:
                continue
        kept.append(sentence)
        previous_tokens = tokens
    return " ".join(kept)


def _lower_initial_for_template(value: str) -> str:
    value = value.strip().rstrip(".")
    if not value:
        return value
    first = re.match(r"^([A-Z][A-Za-z'-]*)(.*)$", value)
    if not first:
        return value
    word, rest = first.groups()
    if (len(word) > 1 and word.isupper()) or re.fullmatch(r"[A-Z]{2,}s?", word):
        return value
    return word[:1].lower() + word[1:] + rest


def _contextual_table_candidate(original: str, context: Dict[str, Any] | None) -> str | None:
    if not context or not original.strip():
        return None
    header = str(context.get("column_header", "") or "").strip()
    if not header:
        return None
    # Keep row identifiers, labels, codes and already sentence-like cells concise.
    if _word_count(original) < 3 or _word_count(original) > 24:
        return None
    if re.fullmatch(r"[A-Z]?\d+(?:[.-]\d+)*", original.strip()):
        return None
    if re.search(r"[.!?]$", original.strip()):
        return None
    for pattern, template in TABLE_HEADER_TEMPLATES:
        if pattern.search(header):
            return template.format(value=_lower_initial_for_template(original))
    return None


def _validate(
    original: str,
    candidate: str,
    table_mode: bool,
    profile: RewriteProfile,
    baseline_original: str | None = None,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    reasons: List[str] = []
    original_words = _word_count(original)
    candidate_words = _word_count(candidate)
    baseline_text = baseline_original or original
    baseline_words = _word_count(baseline_text)
    ratio = (candidate_words / original_words) if original_words else 1.0
    cumulative_ratio = (candidate_words / baseline_words) if baseline_words else 1.0

    if _anchor_multiset(original) != _anchor_multiset(candidate):
        reasons.append("protected facts, numbers, dates, currencies, URLs, or citations changed")

    if not profile.hard_ratio_gate:
        if original_words <= 6:
            min_ratio = 0.70 if table_mode else 0.78
            max_ratio = 3.00 if table_mode else 2.10
        else:
            # The manual and expanded profiles use the requested range as a
            # scoring target. Validation only rejects clear collapse or runaway
            # padding, while still responding to the user's tolerance setting.
            requested_min = profile.table_min_ratio if table_mode else profile.min_ratio
            requested_max = profile.table_max_ratio if table_mode else profile.max_ratio
            min_ratio = max(0.70 if table_mode else 0.78, requested_min - 0.18)
            max_ratio = min(2.40 if table_mode else 2.00, requested_max + 0.28)
    else:
        min_ratio = profile.table_min_ratio if table_mode else profile.min_ratio
        max_ratio = profile.table_max_ratio if table_mode else profile.max_ratio

    if original_words <= 12:
        min_ratio = min(min_ratio, 0.62 if not table_mode else 0.70)
        max_ratio = max(max_ratio, 1.25 if not table_mode else 1.18)

    epsilon = 1e-9
    if ratio + epsilon < min_ratio or ratio - epsilon > max_ratio:
        reasons.append(f"word-count ratio {ratio:.2f} is outside the sanity range {min_ratio:.2f}-{max_ratio:.2f}")
    if cumulative_ratio - epsilon > profile.max_cumulative_ratio:
        reasons.append(
            f"cumulative word-count ratio {cumulative_ratio:.2f} exceeds the original-based cap "
            f"of {profile.max_cumulative_ratio:.2f}"
        )

    overlap = _content_overlap(original, candidate)
    minimum_overlap = profile.table_overlap if table_mode else profile.paragraph_overlap
    if overlap + epsilon < minimum_overlap:
        reasons.append(f"content-token preservation {overlap:.2f} is below {minimum_overlap:.2f}")

    if re.search(r"[!?]{2,}|\.{3,}\.", candidate):
        reasons.append("duplicate or excessive punctuation was introduced")
    if PROMPT_LEAK_RE.search(candidate) and not PROMPT_LEAK_RE.search(original):
        reasons.append("instruction-like or prompt-like wording was introduced")
    if "|sec|" in candidate:
        reasons.append("reserved section marker appeared inside a line")
    if not candidate.strip() and original.strip():
        reasons.append("non-empty content became empty")
    if profile.preserve_sentence_count:
        sentence_delta = abs(_sentence_count(original) - _sentence_count(candidate))
        if sentence_delta > profile.sentence_count_tolerance:
            reasons.append(
                f"sentence count changed by {sentence_delta}, above the allowed tolerance "
                f"of {profile.sentence_count_tolerance}"
            )

    metrics = {
        "original_words": original_words,
        "rewritten_words": candidate_words,
        "word_ratio": round(ratio, 4),
        "baseline_words": baseline_words,
        "cumulative_word_ratio": round(cumulative_ratio, 4),
        "content_overlap": round(overlap, 4),
        "original_sentence_count": _sentence_count(original),
        "rewritten_sentence_count": _sentence_count(candidate),
        "original_anchors": list(_anchor_multiset(original).elements()),
        "rewritten_anchors": list(_anchor_multiset(candidate).elements()),
    }
    return not reasons, reasons, metrics


def rewrite_line(
    text: str,
    profile_name: str = "natural",
    mode: str = "paragraph",
    context: Dict[str, Any] | None = None,
    profile_override: RewriteProfile | None = None,
) -> LineRewriteResult:
    source = _normalise_space(text)
    profile = get_profile(profile_name, profile_override)
    table_mode = mode == "table_cell"
    baseline_original = _normalise_space((context or {}).get("baseline_original_text", source))

    effective_profile = profile
    if table_mode:
        # Tables remain compact: no contractions, conversational scaffolding or
        # rhetorical framing. Compression is permitted but content overlap is high.
        effective_profile = RewriteProfile(**{
            **asdict(profile),
            "use_contractions": False,
            "contraction_intensity": 0,
            "conversational_coordination": False,
            "conversational_intensity": 0,
            "rhetorical_framing": False,
            "framing_intensity": 0,
            "split_long_sentences": False,
            "preserve_sentence_count": False,
            "paragraph_overlap": max(profile.paragraph_overlap, 0.72),
            "table_overlap": max(profile.table_overlap, 0.84),
        })

    protected_source, protected = _protect(source)
    protected_candidates: List[str] = [protected_source]
    protected_candidates.append(_rewrite_sentences(protected_source, effective_profile, table_mode=table_mode))

    compression_max = 2 if table_mode else 10
    compression_limit = max(0, round(compression_max * effective_profile.compression_intensity / 100))
    for count in range(1, compression_limit + 1):
        compact = _apply_limited_rules(
            protected_source,
            COMPRESSION_RULES,
            limit=count,
            start_offset=0,
        )
        if effective_profile.simplify_connectors:
            compact = _apply_limited_rules(
                compact,
                CONNECTOR_RULES,
                limit=max(1, round(len(CONNECTOR_RULES) * effective_profile.connector_intensity / 100)),
            )
        protected_candidates.extend([compact, _split_semicolon_candidate(compact)])

    if table_mode and effective_profile.strategy == "intentional_expansion" and effective_profile.table_intensity >= 20:
        contextual = _contextual_table_candidate(protected_source, context)
        if contextual:
            protected_candidates.append(contextual)

    restored_candidates: List[str] = []
    seen = set()
    for item in protected_candidates:
        item = _dedupe_adjacent_sentences(item)
        item = _repair_local_grammar(item)
        item = _normalise_space(_restore(item, protected))
        if item and item not in seen:
            seen.add(item)
            restored_candidates.append(item)

    valid_candidates: List[Tuple[str, Dict[str, Any], float, Dict[str, float]]] = []
    rejected_reasons: List[str] = []
    for candidate in restored_candidates:
        accepted, reasons, metrics = _validate(
            source,
            candidate,
            table_mode=table_mode,
            profile=effective_profile,
            baseline_original=baseline_original,
        )
        if not accepted:
            rejected_reasons.extend(reasons)
            continue
        cost, objective = _candidate_cost(
            source,
            candidate,
            effective_profile,
            table_mode,
            baseline_original=baseline_original,
        )
        valid_candidates.append((candidate, metrics, cost, objective))

    source_cost, source_objective = _candidate_cost(
        source,
        source,
        effective_profile,
        table_mode,
        baseline_original=baseline_original,
    )

    if not valid_candidates:
        fallback_metrics = {
            "original_words": _word_count(source),
            "rewritten_words": _word_count(source),
            "word_ratio": 1.0,
            "baseline_words": _word_count(baseline_original),
            "cumulative_word_ratio": round(_word_count(source) / max(_word_count(baseline_original), 1), 4),
            "content_overlap": 1.0,
            "source_style_score": source_objective["style_score"],
            "rewritten_style_score": source_objective["style_score"],
            "objective_cost": source_cost,
            "objective_improvement": 0.0,
            "candidate_count": len(restored_candidates),
        }
        return LineRewriteResult(
            original=source,
            rewritten=source,
            changed=False,
            accepted=True,
            mode=mode,
            reasons=["kept source because no changed candidate passed the score, length and preservation gates"],
            metrics=fallback_metrics,
        )

    candidate, metrics, chosen_cost, objective = min(valid_candidates, key=lambda item: item[2])
    improvement = source_cost - chosen_cost
    # The original source is always an available safe outcome. Do not accept a
    # changed line unless it improves the combined score/length objective.
    if candidate != source and improvement < effective_profile.min_objective_improvement:
        candidate = source
        metrics = next((item[1] for item in valid_candidates if item[0] == source), metrics)
        chosen_cost = source_cost
        objective = source_objective
        improvement = 0.0

    metrics = {
        **metrics,
        "source_style_score": source_objective["style_score"],
        "rewritten_style_score": objective["style_score"],
        "objective_cost": round(chosen_cost, 4),
        "source_objective_cost": round(source_cost, 4),
        "objective_improvement": round(improvement, 4),
        "candidate_count": len(valid_candidates),
        "target_word_ratio": effective_profile.table_target_ratio if table_mode else effective_profile.target_ratio,
        "max_cumulative_ratio": effective_profile.max_cumulative_ratio,
    }
    return LineRewriteResult(
        original=source,
        rewritten=candidate,
        changed=candidate != source,
        accepted=True,
        mode=mode,
        reasons=[] if candidate != source else ["kept source because no candidate improved the score-and-length objective"],
        metrics=metrics,
    )


def rewrite_chunk_with_mapping(
    mapping: Dict[str, Any],
    chunk: Dict[str, Any],
    profile_name: str = "natural",
    profile_override: RewriteProfile | None = None,
    source_text: str | None = None,
    engine_name: str = "linguistic",
    use_local_ml: bool = False,  # compatibility only; ignored in v21
    ml_settings: Dict[str, Any] | None = None,  # compatibility only; ignored in v21
    style_profile_name: str = "natural_student",  # compatibility / audit label
    cycle_seed: int = 0,
    protected_terms: Sequence[str] | None = None,
) -> Dict[str, Any]:
    """Rewrite one extraction chunk while preserving the fixed DOCX map.

    V21's recommended ``linguistic`` engine is pure Python and never loads ML
    models. The existing legacy engine remains available for regression testing.
    Repeated passes are unlimited; ``cycle_seed`` rotates deterministic lexical
    alternatives so a later pass can explore a different safe wording.
    """
    from .linguistic_rewriter import build_document_glossary, rewrite_linguistic

    section_indices: List[int] = list(chunk["section_indices"])
    output_sections: List[List[str]] = []
    logs: List[Dict[str, Any]] = []

    current_sections: List[List[str]] | None = None
    if source_text is not None:
        current_sections = parse_extract_text(source_text)
        if len(current_sections) != len(section_indices):
            raise ValueError(
                f"Cycle source has {len(current_sections)} sections; expected {len(section_indices)}."
            )

    # Detect document-wide technical phrases once with deterministic frequency
    # rules. These terms are then hard-protected in every selected line.
    document_texts: List[str] = []
    for section in mapping.get("sections", []):
        for item in section.get("items", []):
            document_texts.append(str(item.get("original_text", "")))
    document_glossary = build_document_glossary(document_texts)

    for local_idx, global_idx in enumerate(section_indices):
        section_meta = mapping["sections"][global_idx]
        section_type = section_meta.get("section_type", "paragraph_group")
        mode = "table_cell" if section_type == "table_row" else "paragraph"
        mapped_lines = [item.get("original_text", "") for item in section_meta.get("items", [])]
        original_lines = current_sections[local_idx] if current_sections is not None else mapped_lines
        if len(original_lines) != len(mapped_lines):
            raise ValueError(
                f"Cycle source section {local_idx + 1} has {len(original_lines)} lines; "
                f"expected {len(mapped_lines)}."
            )
        rewritten_lines: List[str] = []
        headers = section_meta.get("headers", [])

        for line_idx, line in enumerate(original_lines):
            context = {
                "section_type": section_type,
                "table_index": section_meta.get("table_index"),
                "row_index": section_meta.get("row_index"),
                "column_index": line_idx if section_type == "table_row" else None,
                "column_header": headers[line_idx] if line_idx < len(headers) else "",
                "row_values": original_lines if section_type == "table_row" else [],
                "rewrite_source": "current_edited_text" if source_text is not None else "original_extract",
                "baseline_original_text": mapped_lines[line_idx] if line_idx < len(mapped_lines) else line,
            }
            if (engine_name or "linguistic").strip().lower() in {"linguistic", "linguistic_v1", "v21"}:
                lr = rewrite_linguistic(
                    line,
                    profile_name=profile_name,
                    cycle_seed=cycle_seed + global_idx * 17 + line_idx,
                    table_mode=(mode == "table_cell"),
                    user_terms=protected_terms,
                    document_glossary=document_glossary,
                    style_profile_name=style_profile_name,
                    manual_profile=asdict(profile_override) if profile_override else None,
                )
                rewritten_lines.append(lr.rewritten)
                logs.append({
                    "global_section_number": global_idx + 1,
                    "section_number_in_chunk": local_idx + 1,
                    "line_number": line_idx + 1,
                    "section_type": section_type,
                    "context": context,
                    "original": lr.original,
                    "rewritten": lr.rewritten,
                    "changed": lr.changed,
                    "accepted": lr.accepted,
                    "mode": mode,
                    "engine": lr.engine,
                    "generator": lr.generator,
                    "reasons": lr.reasons,
                    "metrics": lr.metrics,
                    "protected": lr.protected,
                })
            else:
                result = rewrite_line(
                    line,
                    profile_name=profile_name,
                    mode=mode,
                    context=context,
                    profile_override=profile_override,
                )
                rewritten_lines.append(result.rewritten)
                logs.append({
                    "global_section_number": global_idx + 1,
                    "section_number_in_chunk": local_idx + 1,
                    "line_number": line_idx + 1,
                    "section_type": section_type,
                    "context": context,
                    "engine": "legacy_v20_rules",
                    "generator": "legacy_v20_rules",
                    **asdict(result),
                })
        output_sections.append(rewritten_lines)

    changed_count = sum(1 for item in logs if item["changed"])
    rejected_count = sum(1 for item in logs if not item["accepted"])
    ratios = [float(item.get("metrics", {}).get("word_ratio", 1.0)) for item in logs]
    source_words = sum(_word_count(item.get("original", "")) for item in logs)
    output_words = sum(_word_count(item.get("rewritten", "")) for item in logs)
    protected_counts = Counter()
    for item in logs:
        protected_counts.update((item.get("protected") or {}).get("categories") or {})

    return {
        "text": sections_to_text(output_sections),
        "sections": output_sections,
        "logs": logs,
        "summary": {
            "profile": profile_override.name if profile_override else profile_name,
            "engine": (engine_name or "linguistic").strip().lower(),
            "ml_used": False,
            "style_profile": style_profile_name,
            "line_count": len(logs),
            "changed_count": changed_count,
            "unchanged_count": len(logs) - changed_count,
            "rejected_count": rejected_count,
            "average_word_ratio": round(sum(ratios) / max(len(ratios), 1), 4),
            "source_word_count": source_words,
            "output_word_count": output_words,
            "word_change": output_words - source_words,
            "protected_categories": dict(protected_counts),
            "document_glossary_count": len(document_glossary),
            "cycle_seed": cycle_seed,
            "selection_basis": "linguistic quality and preservation only; detection score and ML models are not used",
        },
    }
