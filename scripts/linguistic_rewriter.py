from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import asdict, dataclass, replace
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple

from .docx_pipeline_common import WORD_RE

# Pure-Python, non-ML linguistic rewriter.
# Design goals:
# 1) protect factual/technical anchors before any rewrite,
# 2) create strong V12-inspired lexical + structural variants,
# 3) score on preservation, linguistic independence, readability and length,
# 4) compress AFTER rewriting so word count does not compound across passes,
# 5) never use detector output, Transformer models, embeddings or NLI for selection.

SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“‘(])")
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'’-]*|\d+(?:\.\d+)?")
PLACEHOLDER_RE = re.compile(r"ZXQLOCK\d{4}QXZ")

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "because", "been", "being", "but", "by",
    "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
    "here", "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "may",
    "might", "more", "most", "not", "of", "on", "or", "our", "ours", "she", "should", "so",
    "such", "than", "that", "the", "their", "theirs", "them", "then", "there", "these", "they",
    "this", "those", "through", "to", "too", "under", "up", "us", "was", "we", "were", "what",
    "when", "where", "which", "while", "who", "will", "with", "would", "you", "your", "yours",
}

FORMULAIC_PHRASES = (
    "it is important to note", "it should be noted", "it can be seen that", "due to the fact that",
    "for the purpose of", "in order to", "with regard to", "in relation to", "the fact that",
    "plays an important role", "in conclusion", "in summary", "furthermore", "moreover",
    "consequently", "this demonstrates that", "this highlights that", "this indicates that",
    "a comprehensive approach", "it is worth noting", "as part of this analysis",
)

# Hard locks are exact, immutable spans. More specific patterns come first.
HARD_LOCK_PATTERNS: Sequence[Tuple[str, re.Pattern[str]]] = (
    ("url", re.compile(r"https?://[^\s)\]}>,;]+", re.I)),
    ("email", re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")),
    ("code", re.compile(r"`[^`\n]{1,300}`")),
    ("citation", re.compile(r"\([^()]*\b(?:18|19|20)\d{2}[a-z]?\b[^()]*\)")),
    ("citation", re.compile(r"\[[^\]\n]{0,80}(?:18|19|20)\d{2}[a-z]?[^\]\n]{0,80}\]")),
    ("quotation", re.compile(r"“[^”\n]{1,350}”")),
    ("quotation", re.compile(r'"[^"\n]{1,350}"')),
    ("file", re.compile(r"\b[\w.-]+\.(?:docx|pdf|txt|csv|json|xml|xlsx|xls|pptx|ppt|py|js|ts|java|c|cpp|md)\b", re.I)),
    ("currency", re.compile(r"(?<!\w)(?:£|\$|€|¥|PKR|USD|GBP|EUR|JPY|AED|SAR|RM)\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:thousand|million|billion|k|m|bn))?(?!\w)", re.I)),
    ("percentage", re.compile(r"\b\d+(?:\.\d+)?\s?%(?!\w)")),
    ("percentage", re.compile(r"\b\d+(?:\.\d+)?\s?(?:per\s+cent|percent)\b", re.I)),
    ("date", re.compile(r"\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:18|19|20)\d{2}\b", re.I)),
    ("date", re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:18|19|20)\d{2}\b", re.I)),
    ("date", re.compile(r"\b(?:18|19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b")),
    ("date", re.compile(r"\b\d{1,2}[-/]\d{1,2}[-/](?:\d{2}|\d{4})\b")),
    ("time", re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm|AM|PM)?\b")),
    ("phone", re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)")),
    ("ip_address", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("doi", re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.I)),
    ("equation", re.compile(r"(?<!\w)[A-Za-z][A-Za-z0-9_]{0,12}\s*=\s*(?:[-+*/^().\w\s]{1,80})(?=$|[,;.])")),
    ("measurement", re.compile(r"\b\d+(?:\.\d+)?\s?(?:mm|cm|m|km|mg|g|kg|ml|mL|L|ms|s|min|mins|h|hr|hrs|Hz|kHz|MHz|GHz|KB|MB|GB|TB|V|mV|A|mA|W|kW|MW|°C|°F|dpi|px)\b")),
    ("dimension", re.compile(r"\b\d+(?:\.\d+)?\s?[×x]\s?\d+(?:\.\d+)?(?:\s?[×x]\s?\d+(?:\.\d+)?)?\b")),
    ("version", re.compile(r"\bv?\d+(?:\.\d+){1,4}(?:[-+][A-Za-z0-9.-]+)?\b", re.I)),
    ("model_size", re.compile(r"\b\d+(?:\.\d+)?[BMK]\b", re.I)),
    ("identifier", re.compile(r"\b[A-Z]{1,8}\d{1,8}(?:[-_/][A-Za-z0-9]+)*\b")),
    ("identifier", re.compile(r"\b[A-Za-z]+_[A-Za-z0-9_]+\b")),
    ("identifier", re.compile(r"\b[a-z]+[A-Z][A-Za-z0-9]*\b")),
    ("function", re.compile(r"\b[A-Za-z_]\w*\([^\n()]{0,120}\)")),
    ("acronym", re.compile(r"\b[A-Z]{2,}(?:[-/][A-Z0-9]{1,})*\b")),
    ("year", re.compile(r"\b(?:18|19|20)\d{2}\b")),
    ("number", re.compile(r"(?<![A-Za-z])\d+(?:,\d{3})*(?:\.\d+)?(?![A-Za-z])")),
)

TITLE_NAME_RE = re.compile(r"\b(?:Dr|Prof|Professor|Mr|Mrs|Ms|Miss|Sir|Dame)\.?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3}\b")
PROPER_MULTI_RE = re.compile(
    r"\b(?:[A-Z][a-z][A-Za-z'-]*|[A-Z]{2,})(?:\s+(?:(?:of|and|for|the|in|on|to)\s+)?(?:[A-Z][a-z][A-Za-z'-]*|[A-Z]{2,}|[A-Za-z]+\d+)){1,5}\b"
)
ACRONYM_DEFINITION_RE = re.compile(
    r"\b([A-Z][A-Za-z-]+(?:\s+(?:[A-Z][A-Za-z-]+|[a-z][A-Za-z-]+)){1,6})\s+\(([A-Z][A-Z0-9-]{1,12})\)"
)

TECH_MORPH_RE = re.compile(r"(?:tion|sion|ment|ance|ence|ity|ics|ology|graphy|metric|model|system|framework|algorithm|dataset|database|protocol|architecture|pipeline|classifier|regression|analysis|evaluation|verification)$", re.I)


@dataclass(frozen=True)
class LinguisticProfile:
    name: str
    description: str
    lexical_depth: int
    restructure_depth: int
    compression_target: float
    max_sentence_words: int
    use_contractions: bool = False
    min_content_overlap: float = 0.68
    table_min_overlap: float = 0.88
    preferred_independence: float = 0.22


PROFILES: Dict[str, LinguisticProfile] = {
    "light": LinguisticProfile("light", "Small but real lexical changes with exact factual protection.", 35, 20, 1.00, 34, False, 0.78, 0.92, 0.10),
    "natural": LinguisticProfile("natural", "V12-strength natural rewrite followed by word-count compression.", 78, 72, 0.98, 28, False, 0.68, 0.90, 0.24),
    "rewrite_compress": LinguisticProfile("rewrite_compress", "Strong linguistic rewrite followed by stronger compression.", 85, 78, 0.90, 26, False, 0.66, 0.90, 0.28),
    "compress": LinguisticProfile("compress", "Meaning-preserving compression with moderate lexical change.", 55, 35, 0.82, 28, False, 0.70, 0.91, 0.14),
    "plain": LinguisticProfile("plain", "Simple student/professional wording with shorter sentences.", 90, 82, 0.92, 22, True, 0.65, 0.88, 0.30),
    "strong": LinguisticProfile("strong", "Maximum safe linguistic restructuring without intentional expansion.", 100, 100, 0.96, 24, False, 0.64, 0.88, 0.34),
    # Compatibility with earlier names.
    "expanded": LinguisticProfile("strong", "Compatibility alias for strong rewrite; no intentional expansion.", 100, 100, 0.96, 24, False, 0.64, 0.88, 0.34),
    "balanced": LinguisticProfile("natural", "Compatibility alias.", 78, 72, 0.98, 28, False, 0.68, 0.90, 0.24),
    "conservative": LinguisticProfile("light", "Compatibility alias.", 35, 20, 1.00, 34, False, 0.78, 0.92, 0.10),
}


def apply_writing_style(profile: LinguisticProfile, style_name: str) -> LinguisticProfile:
    style = (style_name or "natural_student").strip().lower()
    if style == "simple_student":
        return replace(profile, lexical_depth=max(profile.lexical_depth, 92), restructure_depth=max(profile.restructure_depth, 82), max_sentence_words=min(profile.max_sentence_words, 20), use_contractions=True, compression_target=min(profile.compression_target, 0.92), preferred_independence=max(profile.preferred_independence, 0.30))
    if style == "natural_academic":
        return replace(profile, max_sentence_words=max(26, min(profile.max_sentence_words, 32)), use_contractions=False, preferred_independence=max(profile.preferred_independence, 0.22))
    if style == "plain_professional":
        return replace(profile, lexical_depth=max(profile.lexical_depth, 85), restructure_depth=max(profile.restructure_depth, 68), max_sentence_words=min(profile.max_sentence_words, 24), use_contractions=False, compression_target=min(profile.compression_target, 0.95))
    # Natural student: direct, varied and not over-formal.
    return replace(profile, lexical_depth=max(profile.lexical_depth, 78), restructure_depth=max(profile.restructure_depth, 72), max_sentence_words=min(profile.max_sentence_words, 26), preferred_independence=max(profile.preferred_independence, 0.25))


@dataclass
class ProtectedItem:
    placeholder: str
    value: str
    category: str


@dataclass
class ProtectedRegistry:
    items: List[ProtectedItem]
    glossary: List[str]

    def protect(self, text: str) -> str:
        result = text
        # Longest exact values first so a shorter term cannot break a longer one.
        ordered = sorted(self.items, key=lambda x: len(x.value), reverse=True)
        for item in ordered:
            # Each placeholder represents one specific occurrence. Replace only one.
            result = result.replace(item.value, item.placeholder, 1)
        return result

    def restore(self, text: str) -> str:
        result = text
        for item in self.items:
            result = result.replace(item.placeholder, item.value)
        return result

    def placeholders_intact(self, text: str) -> bool:
        return all(text.count(item.placeholder) == 1 for item in self.items)

    def verify_restored(self, text: str) -> bool:
        original_counts = Counter(item.value for item in self.items)
        return all(text.count(value) >= count for value, count in original_counts.items())

    def summary(self) -> Dict[str, Any]:
        counts = Counter(item.category for item in self.items)
        return {"count": len(self.items), "categories": dict(sorted(counts.items())), "glossary": self.glossary[:40]}


def _normalise(text: str) -> str:
    value = str(text or "").replace("\r", " ").replace("\n", " ")
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    value = re.sub(r"([.!?])(?=[A-Z])", r"\1 ", value)
    return value


def _word_count(text: str) -> int:
    return len(WORD_RE.findall(text or ""))


def _sentence_count(text: str) -> int:
    return len([s for s in SENTENCE_RE.split(text.strip()) if s.strip()]) if text.strip() else 0


def _stable_index(text: str, salt: str, modulo: int) -> int:
    if modulo <= 0:
        return 0
    digest = hashlib.sha256((salt + "\x1f" + text).encode("utf-8", "ignore")).digest()
    return int.from_bytes(digest[:4], "big") % modulo


def _span_overlaps(span: Tuple[int, int], occupied: List[Tuple[int, int]]) -> bool:
    a, b = span
    return any(a < y and b > x for x, y in occupied)


def _candidate_spans(text: str, user_terms: Sequence[str] | None = None) -> List[Tuple[int, int, str]]:
    spans: List[Tuple[int, int, str]] = []
    occupied: List[Tuple[int, int]] = []

    def add(start: int, end: int, category: str):
        if start >= end or _span_overlaps((start, end), occupied):
            return
        occupied.append((start, end))
        spans.append((start, end, category))

    for category, pattern in HARD_LOCK_PATTERNS:
        for match in pattern.finditer(text):
            add(match.start(), match.end(), category)

    for match in ACRONYM_DEFINITION_RE.finditer(text):
        add(match.start(1), match.end(1), "technical_term")
        add(match.start(2), match.end(2), "acronym")

    for pattern, category in ((TITLE_NAME_RE, "name"), (PROPER_MULTI_RE, "proper_name")):
        for match in pattern.finditer(text):
            value = match.group(0).strip()
            # Avoid locking common sentence openings unless they form a strong multiword name.
            if value.lower().startswith(("The ", "This ", "These ", "A ", "An ")):
                continue
            add(match.start(), match.end(), category)

    for term in sorted({str(x).strip() for x in (user_terms or []) if str(x).strip()}, key=len, reverse=True):
        for match in re.finditer(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.I):
            add(match.start(), match.end(), "user_term")

    return sorted(spans)


def detect_technical_glossary(text: str, max_terms: int = 50) -> List[str]:
    """Find likely technical/proper terms without ML.

    The detector deliberately favours preservation. It combines repeated specialist
    n-grams with repeated proper-name/product tokens such as Python, Turnitin,
    TruthfulQA or OpenAI. Sentence-initial function words are excluded.
    """
    source = str(text or "")
    words = re.findall(r"[A-Za-z][A-Za-z0-9_+./-]*", source)
    if len(words) < 4:
        return []
    lowered = [w.lower() for w in words]
    counts: Counter[str] = Counter()
    original_forms: Dict[str, str] = {}
    for n in (2, 3, 4):
        for i in range(0, len(words) - n + 1):
            gram_words = words[i:i+n]
            gram_lower = lowered[i:i+n]
            if gram_lower[0] in STOPWORDS or gram_lower[-1] in STOPWORDS:
                continue
            if sum(w in STOPWORDS for w in gram_lower) > 1:
                continue
            technical = any(
                (len(w) >= 8 and TECH_MORPH_RE.search(w))
                or "-" in w or "_" in w or "/" in w or "+" in w
                or (len(w) >= 2 and w.isupper())
                or bool(re.search(r"[A-Z].*[A-Z]|[a-z].*[A-Z]|\d", w))
                for w in gram_words
            )
            if not technical:
                continue
            key = " ".join(gram_lower)
            counts[key] += 1
            original_forms.setdefault(key, " ".join(gram_words))

    # Repeated single-token proper/product/model names are also valuable locks.
    single_counts: Counter[str] = Counter()
    single_forms: Dict[str, str] = {}
    common_caps = {
        "The", "This", "These", "Those", "A", "An", "In", "On", "At", "For", "From",
        "To", "As", "If", "When", "While", "Because", "Although", "However", "Therefore",
        "Moreover", "Furthermore", "Consequently", "Figure", "Table", "Chapter", "Section",
    }
    for token in re.findall(r"\b[A-Z][A-Za-z0-9_+.-]{2,}\b", source):
        if token in common_caps:
            continue
        key = token.lower()
        single_counts[key] += 1
        single_forms.setdefault(key, token)
    for key, count in single_counts.items():
        form = single_forms[key]
        if count >= 2 or form.isupper() or re.search(r"[a-z][A-Z]|\d", form):
            counts[key] += count
            original_forms.setdefault(key, form)

    ranked = [key for key, count in counts.most_common() if count >= 2 or (" " not in key and original_forms.get(key, "").isupper())]
    result: List[str] = []
    for key in ranked:
        phrase = original_forms[key]
        lower_phrase = phrase.lower()
        # Prefer longer phrases, but do not drop useful single model/product names.
        if " " in phrase and any(lower_phrase in existing.lower() and lower_phrase != existing.lower() for existing in result):
            continue
        result.append(phrase)
        if len(result) >= max_terms:
            break
    return result


def build_protected_registry(text: str, user_terms: Sequence[str] | None = None, auto_terms: bool = True) -> ProtectedRegistry:
    source = str(text or "")
    glossary = detect_technical_glossary(source) if auto_terms else []
    combined_terms = list(user_terms or []) + glossary
    spans = _candidate_spans(source, combined_terms)
    items: List[ProtectedItem] = []
    for index, (start, end, category) in enumerate(spans, start=1):
        value = source[start:end]
        if not value.strip():
            continue
        items.append(ProtectedItem(f"ZXQLOCK{index:04d}QXZ", value, category))
    return ProtectedRegistry(items=items, glossary=glossary)


# V12-inspired transformations, redesigned to avoid expansion as the end state.
PHRASE_RULES: Sequence[Tuple[re.Pattern[str], Sequence[str]]] = (
    (re.compile(r"\bis capable of providing an explanation of\b", re.I), ("can explain",)),
    (re.compile(r"\bare capable of providing an explanation of\b", re.I), ("can explain",)),
    (re.compile(r"\bin order to\b", re.I), ("to",)),
    (re.compile(r"\bmakes use of\b", re.I), ("uses",)),
    (re.compile(r"\bmake use of\b", re.I), ("use",)),
    (re.compile(r"\bmaking use of\b", re.I), ("using",)),
    (re.compile(r"\bdue to the fact that\b", re.I), ("because", "since")),
    (re.compile(r"\bfor the purpose of\b", re.I), ("to",)),
    (re.compile(r"\bwith regard to\b", re.I), ("about", "for")),
    (re.compile(r"\bin relation to\b", re.I), ("about", "for")),
    (re.compile(r"\bon the basis of\b", re.I), ("based on", "from")),
    (re.compile(r"\ba number of\b", re.I), ("several", "some")),
    (re.compile(r"\bthe majority of\b", re.I), ("most",)),
    (re.compile(r"\bhas the ability to\b", re.I), ("can",)),
    (re.compile(r"\bis able to\b", re.I), ("can",)),
    (re.compile(r"\bare able to\b", re.I), ("can",)),
    (re.compile(r"\bis capable of\b", re.I), ("can",)),
    (re.compile(r"\butilises\b", re.I), ("uses",)),
    (re.compile(r"\butilise\b", re.I), ("use",)),
    (re.compile(r"\butilised\b", re.I), ("used",)),
    (re.compile(r"\butilising\b", re.I), ("using",)),
    (re.compile(r"\bdemonstrates\b", re.I), ("shows", "indicates")),
    (re.compile(r"\bdemonstrate\b", re.I), ("show", "indicate")),
    (re.compile(r"\bcommence\b", re.I), ("begin", "start")),
    (re.compile(r"\bcommences\b", re.I), ("begins", "starts")),
    (re.compile(r"\bcommenced\b", re.I), ("began", "started")),
    (re.compile(r"\bprior to\b", re.I), ("before",)),
    (re.compile(r"\bsubsequent to\b", re.I), ("after",)),
    (re.compile(r"\bsubsequently\b", re.I), ("then", "later")),
    (re.compile(r"\bnumerous\b", re.I), ("many",)),
    (re.compile(r"\bprimarily\b", re.I), ("mainly",)),
    (re.compile(r"\bcontains\b", re.I), ("includes",)),
    (re.compile(r"\bconsists of\b", re.I), ("includes",)),
    (re.compile(r"\bprovides an explanation of\b", re.I), ("explains",)),
    (re.compile(r"\bprovide an explanation of\b", re.I), ("explain",)),
    (re.compile(r"\bconduct an analysis of\b", re.I), ("analyse",)),
    (re.compile(r"\bconducted an analysis of\b", re.I), ("analysed",)),
    (re.compile(r"\bperform an evaluation of\b", re.I), ("evaluate",)),
    (re.compile(r"\btake into consideration\b", re.I), ("consider",)),
    (re.compile(r"\binvolves the use of\b", re.I), ("uses",)),
    (re.compile(r"\bcan be used to\b", re.I), ("can",)),
    (re.compile(r"\bprovides support for\b", re.I), ("supports",)),
    (re.compile(r"\bprovides a description of\b", re.I), ("describes",)),
    (re.compile(r"\bprovides an indication of\b", re.I), ("indicates", "shows")),
    (re.compile(r"\bcarries out a review of\b", re.I), ("reviews",)),
    (re.compile(r"\bconducts a review of\b", re.I), ("reviews",)),
    (re.compile(r"\bperforms a calculation of\b", re.I), ("calculates",)),
    (re.compile(r"\bperforms a check on\b", re.I), ("checks",)),
    (re.compile(r"\bis responsible for\b", re.I), ("handles", "manages")),
    (re.compile(r"\bterminates\b", re.I), ("ends", "stops")),
    (re.compile(r"\bterminate\b", re.I), ("end", "stop")),
    (re.compile(r"\bguarantees\b", re.I), ("ensures", "makes sure")),
    (re.compile(r"\bguarantee\b", re.I), ("ensure", "make sure")),
    (re.compile(r"\binitialises ([^,.;]{1,55})", re.I), (r"sets up \1",)),
    (re.compile(r"\binitialise ([^,.;]{1,55})", re.I), (r"set up \1",)),
    (re.compile(r"\bsupplied\b", re.I), ("provided", "given")),
    (re.compile(r"\bpermits\b", re.I), ("allows",)),
    (re.compile(r"\bpermit\b", re.I), ("allow",)),
    (re.compile(r"\benables\b", re.I), ("allows",)),
    (re.compile(r"\benable\b", re.I), ("allow",)),
    (re.compile(r"\bfacilitates\b", re.I), ("helps",)),
    (re.compile(r"\bfacilitate\b", re.I), ("help",)),
    (re.compile(r"\bmaintains\b", re.I), ("keeps",)),
    (re.compile(r"\bmaintain\b", re.I), ("keep",)),
    (re.compile(r"\bretains\b", re.I), ("keeps",)),
    (re.compile(r"\bretain\b", re.I), ("keep",)),
    (re.compile(r"\billustrates\b", re.I), ("shows",)),
    (re.compile(r"\billustrate\b", re.I), ("show",)),
    (re.compile(r"\badditional\b", re.I), ("extra", "other")),
    (re.compile(r"\bsufficient\b", re.I), ("enough",)),
    (re.compile(r"\bprincipal\b", re.I), ("main",)),
    (re.compile(r"\bprimarily\b", re.I), ("mainly",)),
    (re.compile(r"\bcurrently\b", re.I), ("now",)),
    (re.compile(r"\bsubsequent\b", re.I), ("later", "next")),
    (re.compile(r"\bindividual\b", re.I), ("single",)),
    (re.compile(r"\bchosen\b", re.I), ("selected",)),
        (re.compile(r"\bcontains\b", re.I), ("includes",)),
    (re.compile(r"\bcontain\b", re.I), ("include",)),
    (re.compile(r"\bstores\b", re.I), ("keeps", "records")),
    (re.compile(r"\bstore\b", re.I), ("keep", "record")),
    (re.compile(r"\breturns\b", re.I), ("goes back", "returns")),
    (re.compile(r"\breturn\b", re.I), ("go back", "return")),
    (re.compile(r"\bcauses termination\b", re.I), ("ends the process", "stops the process")),
    (re.compile(r"\bexposes\b", re.I), ("shows", "reveals")),
    (re.compile(r"\bexpose\b", re.I), ("show", "reveal")),
    (re.compile(r"\brejects\b", re.I), ("refuses", "rejects")),
    (re.compile(r"\bconfirms\b", re.I), ("shows", "confirms")),
    (re.compile(r"\bestablishes\b", re.I), ("shows", "establishes")),
    (re.compile(r"\bpreserves\b", re.I), ("keeps", "preserves")),
    (re.compile(r"\bpreserve\b", re.I), ("keep", "preserve")),
    (re.compile(r"\bnevertheless\b", re.I), ("still", "even so")),
    (re.compile(r"\bconsequently\b", re.I), ("so", "as a result")),
    (re.compile(r"\bfurther\b", re.I), ("more", "further")),
    (re.compile(r"\bsubstantial\b", re.I), ("large", "major")),
)

# V12's decompression/conversational strategies are retained only as intermediate
# candidates. Every such candidate is passed through the compression layer before
# it can be selected, so their old word-count inflation does not become the final text.
V12_DECOMPRESSION_RULES: Sequence[Tuple[re.Pattern[str], Sequence[str]]] = (
    (re.compile(r"\buses\b", re.I), ("makes use of",)),
    (re.compile(r"\bcreates\b", re.I), ("helps create",)),
    (re.compile(r"\bimproves\b", re.I), ("helps improve",)),
    (re.compile(r"\breduces\b", re.I), ("helps reduce",)),
    (re.compile(r"\bsupports\b", re.I), ("helps support",)),
    (re.compile(r"\bdepends on\b", re.I), ("is dependent on",)),
    (re.compile(r"\bfocuses on\b", re.I), ("puts its focus on",)),
    (re.compile(r"\bshows that\b", re.I), ("makes clear that",)),
    (re.compile(r"\bmeans that\b", re.I), ("can mean that",)),
    (re.compile(r"\bthrough\b", re.I), ("by means of",)),
    (re.compile(r"\brather than\b", re.I), ("instead of",)),
    (re.compile(r"\brequires\b", re.I), ("calls for",)),
    (re.compile(r"\ballows\b", re.I), ("makes it possible for",)),
    (re.compile(r"\bprovides\b", re.I), ("helps provide",)),
)

V12_CONVERSATIONAL_RULES: Sequence[Tuple[re.Pattern[str], Sequence[str]]] = (
    (re.compile(r"^However,\s*", re.I), ("But ", "Still, ")),
    (re.compile(r"^Therefore,\s*", re.I), ("So, ", "Because of this, ")),
    (re.compile(r"^Consequently,\s*", re.I), ("So, ", "As a result, ")),
    (re.compile(r"^Moreover,\s*", re.I), ("Also, ", "And ")),
    (re.compile(r"^Furthermore,\s*", re.I), ("Also, ", "And ")),
    (re.compile(r"^Nevertheless,\s*", re.I), ("Still, ", "But ")),
)

CONNECTOR_RULES: Sequence[Tuple[re.Pattern[str], Sequence[str]]] = (
    (re.compile(r"^Furthermore,\s*", re.I), ("Also, ", "")),
    (re.compile(r"^Moreover,\s*", re.I), ("Also, ", "")),
    (re.compile(r"^Nevertheless,\s*", re.I), ("Still, ", "But ")),
    (re.compile(r"^Consequently,\s*", re.I), ("So, ", "As a result, ")),
    (re.compile(r"^Therefore,\s*", re.I), ("So, ", "As a result, ")),
    (re.compile(r"^However,\s*", re.I), ("But ", "Still, ")),
    (re.compile(r"^Additionally,\s*", re.I), ("Also, ", "")),
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
    (re.compile(r"\bwould not\b", re.I), "wouldn't"),
    (re.compile(r"\bis not\b", re.I), "isn't"),
    (re.compile(r"\bare not\b", re.I), "aren't"),
)

COMPRESSION_RULES: Sequence[Tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bis capable of providing an explanation of\b", re.I), "can explain"),
    (re.compile(r"\bare capable of providing an explanation of\b", re.I), "can explain"),
    (re.compile(r"\bit is important to note that\s*", re.I), ""),
    (re.compile(r"\bit should be noted that\s*", re.I), ""),
    (re.compile(r"\bit can be seen that\s*", re.I), ""),
    (re.compile(r"\bit is worth noting that\s*", re.I), ""),
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
    (re.compile(r"\bmakes use of\b", re.I), "uses"),
    (re.compile(r"\bmake use of\b", re.I), "use"),
    (re.compile(r"\bprovided an explanation of\b", re.I), "explained"),
    (re.compile(r"\bprovides an explanation of\b", re.I), "explains"),
    (re.compile(r"\bprovide an explanation of\b", re.I), "explain"),
    (re.compile(r"\bconduct an analysis of\b", re.I), "analyse"),
    (re.compile(r"\bconducted an analysis of\b", re.I), "analysed"),
    (re.compile(r"\bperform an evaluation of\b", re.I), "evaluate"),
    (re.compile(r"\bcarried out an evaluation of\b", re.I), "evaluated"),
    (re.compile(r"\btake into consideration\b", re.I), "consider"),
    (re.compile(r"\ba large number of\b", re.I), "many"),
    (re.compile(r"\bthe majority of\b", re.I), "most"),
    (re.compile(r"\bwas found to be\b", re.I), "was"),
    (re.compile(r"\bwere found to be\b", re.I), "were"),
    (re.compile(r"\bthe results of the analysis (?:showed|demonstrated) that\b", re.I), "the analysis showed that"),
    (re.compile(r"\bplays an important role in\b", re.I), "supports"),
    (re.compile(r"\bplay an important role in\b", re.I), "support"),
    (re.compile(r"\bin a manner that\b", re.I), "so that"),
    (re.compile(r"\bfor the reason that\b", re.I), "because"),
    (re.compile(r"\bin terms of\b", re.I), "for"),
    (re.compile(r"\bhelps to (create|improve|reduce|support|provide|protect|develop)\b", re.I), r"\1s"),
    (re.compile(r"\bhelps (create|improve|reduce|support|provide|protect|develop)\b", re.I), r"\1s"),
    (re.compile(r"\bis dependent on\b", re.I), "depends on"),
    (re.compile(r"\bputs its focus on\b", re.I), "focuses on"),
    (re.compile(r"\bmakes clear that\b", re.I), "shows that"),
    (re.compile(r"\bby means of\b", re.I), "through"),
    (re.compile(r"\bcalls for\b", re.I), "requires"),
    (re.compile(r"\bmakes it possible for ([A-Za-z][A-Za-z'-]*) to\b", re.I), r"allows \1 to"),
    (re.compile(r"\bas a result of this,?\s*", re.I), "so "),
    (re.compile(r"\bbecause of this,?\s*", re.I), "so "),
    (re.compile(r"\band in addition,?\s*", re.I), "also "),
    (re.compile(r"\bwhen this is applied in practice\b", re.I), "in practice"),
    (re.compile(r"\bas a practical example\b", re.I), "for example"),
)


def _capitalise_first_alpha(text: str) -> str:
    for i, ch in enumerate(text):
        if ch.isalpha():
            return text[:i] + ch.upper() + text[i + 1:]
    return text


def _apply_variant_rules(text: str, rules: Sequence[Tuple[re.Pattern[str], Sequence[str]]], depth: int, salt: str) -> str:
    result = text
    max_rules = max(1, round(len(rules) * max(0, min(depth, 100)) / 100.0))
    applied = 0
    for index, (pattern, replacements) in enumerate(rules):
        if applied >= max_rules:
            break
        match = pattern.search(result)
        if not match:
            continue
        replacement = replacements[_stable_index(result, f"{salt}:{index}", len(replacements))]
        def repl(m: re.Match[str]) -> str:
            expanded = m.expand(replacement)
            original = m.group(0)
            # Preserve sentence-initial/title capitalization for lexical swaps.
            first_original = next((c for c in original if c.isalpha()), "")
            if first_original and first_original.isupper():
                expanded = _capitalise_first_alpha(expanded)
            return expanded
        result = pattern.sub(repl, result, count=1)
        applied += 1
    return result


def _case_preserving_sub(pattern: re.Pattern[str], replacement: str, text: str, *, count: int = 0) -> str:
    """Apply a deterministic replacement without accidentally lowercasing a sentence start."""
    def repl(m: re.Match[str]) -> str:
        expanded = m.expand(replacement)
        original = m.group(0)
        first_original = next((c for c in original if c.isalpha()), "")
        if first_original and first_original.isupper():
            expanded = _capitalise_first_alpha(expanded)
        return expanded
    return pattern.sub(repl, text, count=count)


def _apply_compression(text: str, max_rules: int | None = None) -> str:
    result = text
    count = 0
    for pattern, replacement in COMPRESSION_RULES:
        new = _case_preserving_sub(pattern, replacement, result)
        if new != result:
            result = new
            count += 1
            if max_rules is not None and count >= max_rules:
                break
    return _repair_grammar(_normalise(result))


def _repair_grammar(text: str) -> str:
    value = _normalise(text)
    # Repair common source/rewrite artefacts without changing fragment casing.
    value = re.sub(r"\bbecause of(?: the fact that of)+ the fact that\b", "because", value, flags=re.I)
    value = re.sub(r"\bbecause of the fact that\b", "because", value, flags=re.I)
    value = re.sub(r"\bof the fact that(?: of the fact that)+\b", "that", value, flags=re.I)
    value = re.sub(r"\b(the|a|an)\s+\1\b", r"\1", value, flags=re.I)
    value = re.sub(r"\b(\w+)\s+\1\b", r"\1", value, flags=re.I)
    value = re.sub(r"\bshows?\s+show\b", "shows", value, flags=re.I)
    value = re.sub(r"\ban\s+(single|unique)\b", r"a \1", value, flags=re.I)
    value = re.sub(r"\ba\s+individual\b", "an individual", value, flags=re.I)
    value = re.sub(r",\s*,+", ", ", value)
    value = re.sub(r"\.\s*\.", ".", value)
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    return value


def _capitalise_after_split(text: str) -> str:
    return re.sub(r"(?<=[.!?])\s+([a-z])", lambda m: " " + m.group(1).upper(), text)


def _looks_independent_clause(text: str) -> bool:
    value = text.strip(" ,;:.\t")
    if not value or len(value.split()) < 3:
        return False
    if re.match(r"^(?:to\b|(?:scoping|identifying|defining|developing|selecting|using|including|containing|providing|reviewing|analysing|analyzing)\b)", value, re.I):
        return False
    # Require an explicit finite auxiliary/modal, or a clear pronoun+noun/verb construction.
    if re.search(r"\b(?:is|are|was|were|has|have|had|will|would|can|could|may|might|must|should|does|do|did)\b", value, re.I):
        return True
    if re.match(r"^(?:I|we|you|he|she|they|it|this|that|these|those)\s+[A-Za-z][A-Za-z'-]*(?:s|ed)?\b", value, re.I):
        return True
    return False


def _split_long(sentence: str, max_words: int) -> str:
    if _word_count(sentence) <= max_words:
        return sentence
    # Split only when the text after the semicolon is an independent clause.
    if ";" in sentence:
        left, right = sentence.split(";", 1)
        right_clean = re.sub(r"^\s*however,?\s*", "", right, flags=re.I)
        if _looks_independent_clause(right_clean):
            return _repair_grammar(_capitalise_after_split(f"{left.strip()}. {right_clean.strip()}"))
    return sentence


def _clause_reorder_variants(sentence: str) -> List[str]:
    s = sentence.strip()
    terminal = s[-1] if s and s[-1] in ".!?" else ""
    core = s[:-1] if terminal else s
    variants: List[str] = []

    # Front subordinate clause -> main clause first.
    m = re.match(r"^(Because|Although|While|When|If|Since)\s+(.+?),\s+(.+)$", core, re.I)
    if m:
        lead, subordinate, main = m.groups()
        lower = lead.lower()
        if lower == "because":
            variants.append(f"{main} because {subordinate}{terminal}")
        elif lower == "since":
            variants.append(f"{main} since {subordinate}{terminal}")
        elif lower == "although":
            variants.append(f"{main}, although {subordinate}{terminal}")
        elif lower == "while":
            variants.append(f"{main} while {subordinate}{terminal}")
        elif lower == "when":
            variants.append(f"{main} when {subordinate}{terminal}")
        elif lower == "if":
            variants.append(f"{main} if {subordinate}{terminal}")

    # Main clause because/since clause -> subordinate first.
    m = re.match(r"^(.+?)\s+(because|since)\s+(.+)$", core, re.I)
    if m and len(m.group(1).split()) >= 4 and len(m.group(3).split()) >= 3:
        main, link, reason = m.groups()
        if not re.match(r"^(?:For|In|At|On|Under|With|By|From)\b", main, re.I):
            variants.append(f"{link.capitalize()} {reason}, {main[0].lower() + main[1:]}{terminal}")

    # V12-style semicolon split, but only when both sides are complete clauses.
    if ";" in core:
        left, right = core.split(";", 1)
        right_clean = re.sub(r"^\s*however,?\s*", "", right, flags=re.I)
        if len(left.split()) >= 4 and _looks_independent_clause(right_clean):
            variants.append(_repair_grammar(_capitalise_after_split(f"{left.strip()}. {right_clean.strip()}{terminal}")))

    if ":" in core:
        left, right = core.split(":", 1)
        if len(left.split()) >= 5 and len(right.split()) >= 4 and _looks_independent_clause(right) and not re.match(r"^\s*(?:[0-9]|ZXQLOCK)", right):
            variants.append(_repair_grammar(f"{left}. {_capitalise_first_alpha(right.strip())}{terminal}"))

    # Move common introductory phrases to the end where safe.
    m = re.match(r"^(In practice|For example|In this case|As a result|At the same time),\s+(.+)$", core, re.I)
    if m and len(m.group(2).split()) >= 5:
        intro, rest = m.groups()
        if intro.lower() == "for example":
            variants.append(f"{rest}, for example{terminal}")
        elif intro.lower() == "in practice":
            variants.append(f"{rest} in practice{terminal}")

    # Move a fronted time/place/condition phrase to the end. This is a
    # high-value deterministic rhythm change used heavily in natural editing.
    m = re.match(r"^((?:At|In|On|During|After|Before|Within|Under|For)\s+[^,]{2,70}),\s+(.+)$", core, re.I)
    if m and len(m.group(2).split()) >= 4:
        adjunct, main = m.groups()
        variants.append(f"{_capitalise_first_alpha(main)} {adjunct[0].lower() + adjunct[1:]}{terminal}")

    # Non-restrictive which-clause can be split into a short follow-up sentence.
    m = re.match(r"^(.+?),\s+which\s+(.+)$", core, re.I)
    if m and len(m.group(1).split()) >= 4 and len(m.group(2).split()) >= 4:
        left, right = m.groups()
        variants.append(f"{left}. This {right}{terminal}")

    # Explicit result relation can often be expressed as two direct sentences.
    m = re.match(r"^(.+?),\s+(?:which means that|meaning that)\s+(.+)$", core, re.I)
    if m and len(m.group(1).split()) >= 4:
        left, right = m.groups()
        variants.append(f"{left}. So {right}{terminal}")

    # Mid-sentence therefore is handled structurally rather than by a blind
    # synonym swap (which can create forms such as "Q so prints").
    if re.search(r"\s+therefore\s+", core, re.I):
        variants.append(_repair_grammar(re.sub(r"\s+therefore\s+", " ", core, count=1, flags=re.I) + terminal))

    return [_repair_grammar(v) for v in variants if v.strip()]


def _lexical_variants(sentence: str, profile: LinguisticProfile, cycle_seed: int) -> List[str]:
    variants = [sentence]
    simplified = _apply_variant_rules(sentence, PHRASE_RULES, profile.lexical_depth, f"lex:{cycle_seed}")
    simplified = _apply_variant_rules(simplified, CONNECTOR_RULES, profile.lexical_depth, f"con:{cycle_seed}")
    variants.append(_repair_grammar(simplified))

    # Rotate through alternative word choices on repeat passes.
    for shift in range(1, 4):
        v = _apply_variant_rules(sentence, PHRASE_RULES, min(100, profile.lexical_depth + shift * 8), f"lex:{cycle_seed + shift}")
        v = _apply_variant_rules(v, CONNECTOR_RULES, min(100, profile.lexical_depth + shift * 6), f"con:{cycle_seed + shift}")
        variants.append(_repair_grammar(v))

    if profile.use_contractions:
        v = simplified
        for pattern, replacement in CONTRACTION_RULES:
            v = pattern.sub(replacement, v)
        variants.append(_repair_grammar(v))

    # Bring back V12's high-coverage variation as *intermediate* wording. The
    # caller compresses every candidate before ranking, so this can change the
    # lexical path without retaining V12's old expansion target.
    if profile.lexical_depth >= 70:
        for shift in range(2):
            v = _apply_variant_rules(simplified, V12_DECOMPRESSION_RULES, min(100, 45 + profile.lexical_depth // 2), f"v12d:{cycle_seed + shift}")
            variants.append(_repair_grammar(v))
    if profile.restructure_depth >= 55:
        v = _apply_variant_rules(simplified, V12_CONVERSATIONAL_RULES, min(100, profile.restructure_depth), f"v12c:{cycle_seed}")
        variants.append(_repair_grammar(v))

    return variants


CONTENT_CANONICAL = {
    "utilis": "use", "use": "use", "demonstrat": "show", "show": "show", "indicat": "show",
    "explanation": "explain", "explain": "explain", "provid": "provide", "capabl": "ability",
    "analys": "analyse", "analysis": "analyse", "evaluat": "evaluate", "evaluation": "evaluate",
    "approximately": "about", "roughly": "about", "commenc": "start", "begin": "start", "start": "start",
}

def _content_tokens(text: str) -> set[str]:
    tokens = set()
    for raw in TOKEN_RE.findall(text or ""):
        token = raw.lower().strip("'-")
        if token.startswith("zxqlock") or token in STOPWORDS or len(token) < 3:
            continue
        # Conservative suffix normalization.
        for suffix in ("isation", "ization", "ational", "fulness", "iveness", "ments", "ment", "ingly", "edly", "ing", "ies", "ied", "ed", "es", "s"):
            if len(token) > len(suffix) + 3 and token.endswith(suffix):
                token = token[:-len(suffix)]
                break
        token = CONTENT_CANONICAL.get(token, token)
        # Generic helper words are weak content anchors and should not block safe compression.
        if token in {"provide", "ability", "make", "help"}:
            continue
        tokens.add(token)
    return tokens


def _content_overlap(source: str, candidate: str) -> float:
    a = _content_tokens(source)
    if not a:
        return 1.0
    b = _content_tokens(candidate)
    return len(a & b) / len(a)


def _lexical_similarity(source: str, candidate: str) -> float:
    a = [x.lower() for x in TOKEN_RE.findall(source) if not x.lower().startswith("zxqlock")]
    b = [x.lower() for x in TOKEN_RE.findall(candidate) if not x.lower().startswith("zxqlock")]
    if not a or not b:
        return 1.0 if a == b else 0.0
    aset, bset = set(a), set(b)
    jaccard = len(aset & bset) / max(len(aset | bset), 1)
    sequence = SequenceMatcher(None, " ".join(a), " ".join(b)).ratio()
    return (jaccard + sequence) / 2.0


def _formulaic_count(text: str) -> int:
    lower = text.lower()
    return sum(lower.count(p) for p in FORMULAIC_PHRASES)


def _readability_score(text: str, profile: LinguisticProfile) -> float:
    sentences = [s for s in SENTENCE_RE.split(text.strip()) if s.strip()]
    if not sentences:
        return 0.0
    lengths = [_word_count(s) for s in sentences]
    over = sum(max(0, n - profile.max_sentence_words) for n in lengths)
    long_penalty = min(40.0, over * 2.0)
    avg_word_len = sum(len(w) for w in TOKEN_RE.findall(text)) / max(len(TOKEN_RE.findall(text)), 1)
    word_penalty = max(0.0, avg_word_len - 6.2) * 6.0
    punctuation_penalty = text.count(";") * 4.0
    return max(0.0, 100.0 - long_penalty - word_penalty - punctuation_penalty)


def _candidate_score(source: str, candidate: str, profile: LinguisticProfile, table_mode: bool) -> Tuple[float, Dict[str, float]]:
    sw = max(_word_count(source), 1)
    cw = _word_count(candidate)
    ratio = cw / sw
    overlap = _content_overlap(source, candidate)
    similarity = _lexical_similarity(source, candidate)
    independence = 1.0 - similarity
    min_overlap = profile.table_min_overlap if table_mode else profile.min_content_overlap

    if overlap < min_overlap:
        return -1e9, {"word_ratio": ratio, "content_overlap": overlap, "lexical_similarity": similarity, "linguistic_independence": independence}
    # Final natural rewrite must not grow beyond the source. Source itself is always available.
    if ratio > 1.005 and not table_mode:
        return -1e9, {"word_ratio": ratio, "content_overlap": overlap, "lexical_similarity": similarity, "linguistic_independence": independence}
    if table_mode and ratio > 1.01:
        return -1e9, {"word_ratio": ratio, "content_overlap": overlap, "lexical_similarity": similarity, "linguistic_independence": independence}

    target = 1.0 if table_mode else profile.compression_target
    length_fit = max(0.0, 1.0 - abs(ratio - target) / 0.35)
    # Reward independence until the profile target, then taper to avoid needless rewriting.
    ideal = profile.preferred_independence * (0.55 if table_mode else 1.0)
    independence_fit = max(0.0, 1.0 - abs(independence - ideal) / max(ideal + 0.16, 0.2))
    readability = _readability_score(candidate, profile) / 100.0
    formulaic_gain = max(-1.0, min(1.0, (_formulaic_count(source) - _formulaic_count(candidate)) / 3.0))
    change_bonus = 1.0 if candidate != source else 0.0

    score = (
        overlap * (48.0 if table_mode else 32.0)
        + length_fit * 24.0
        + independence_fit * (7.0 if table_mode else 22.0)
        + readability * 14.0
        + formulaic_gain * 6.0
        + change_bonus * (1.0 if table_mode else 2.0)
    )
    return score, {
        "word_ratio": round(ratio, 4),
        "content_overlap": round(overlap, 4),
        "lexical_similarity": round(similarity, 4),
        "linguistic_independence": round(independence, 4),
        "length_fit": round(length_fit, 4),
        "readability": round(readability * 100.0, 2),
        "formulaic_gain": round(formulaic_gain, 4),
        "linguistic_score": round(score, 4),
    }


def _compress_to_target(text: str, source_words: int, profile: LinguisticProfile, table_mode: bool) -> str:
    target_words = max(1, round(source_words * (1.0 if table_mode else profile.compression_target)))
    result = _repair_grammar(text)
    if _word_count(result) <= target_words:
        return result
    for pattern, replacement in COMPRESSION_RULES:
        new = _repair_grammar(_case_preserving_sub(pattern, replacement, result))
        if new != result and _word_count(new) <= _word_count(result):
            result = new
            if _word_count(result) <= target_words:
                break
    # Remove only near-duplicate adjacent sentences; never delete a unique sentence.
    sentences = [s.strip() for s in SENTENCE_RE.split(result) if s.strip()]
    kept: List[str] = []
    for sentence in sentences:
        if kept:
            sim = _lexical_similarity(kept[-1], sentence)
            if sim >= 0.90 and _content_overlap(kept[-1], sentence) >= 0.88:
                # Keep the shorter of two near-duplicates.
                if _word_count(sentence) < _word_count(kept[-1]):
                    kept[-1] = sentence
                continue
        kept.append(sentence)
    result = _repair_grammar(" ".join(kept))
    return result


def _rewrite_protected_sentence(sentence: str, profile: LinguisticProfile, cycle_seed: int, table_mode: bool) -> Tuple[str, Dict[str, Any]]:
    source = _repair_grammar(sentence)
    candidates: List[str] = [source]
    candidates.extend(_lexical_variants(source, profile, cycle_seed))
    if not table_mode and profile.restructure_depth >= 30:
        for base in list(candidates):
            candidates.extend(_clause_reorder_variants(base))
            if profile.restructure_depth >= 55:
                candidates.append(_split_long(base, profile.max_sentence_words))
    # V12 lesson: allow an expressive intermediate, but compress it before ranking.
    compressed: List[str] = []
    source_words = _word_count(source)
    for candidate in candidates:
        candidate = _compress_to_target(candidate, source_words, profile, table_mode)
        compressed.append(_repair_grammar(candidate))

    seen = set()
    unique = []
    for item in compressed:
        if item and item not in seen:
            seen.add(item)
            unique.append(item)

    scored = []
    for item in unique:
        score, metrics = _candidate_score(source, item, profile, table_mode)
        if score <= -1e8:
            continue
        scored.append((score, item, metrics))
    if not scored:
        score, metrics = _candidate_score(source, source, profile, table_mode)
        return source, {**metrics, "candidate_count": len(unique), "selected_score": round(score, 4)}
    scored.sort(key=lambda row: (row[0], row[1] != source), reverse=True)
    best_score = scored[0][0]
    # Repeat cycles should explore a genuinely different but still near-best safe
    # linguistic path. Rotate only among candidates close to the best score so
    # unlimited manual rewrites do not mean unlimited quality degradation.
    near_best = [row for row in scored if row[0] >= best_score - 0.85]
    changed_near = [row for row in near_best if row[1] != source]
    pool = changed_near or near_best
    pick = _stable_index(source, f"select:{cycle_seed}", len(pool))
    score, selected, metrics = pool[pick]
    return selected, {**metrics, "candidate_count": len(unique), "selected_score": round(score, 4), "near_best_count": len(pool)}


def profile_from_manual(settings: Mapping[str, Any] | None) -> LinguisticProfile | None:
    if not settings:
        return None
    try:
        lexical = int(settings.get("lexical_intensity", 75))
        compression = int(settings.get("compression_intensity", 70))
        target = float(settings.get("target_ratio", 0.98))
        max_words = int(settings.get("max_sentence_words", 28))
        contractions = bool(settings.get("use_contractions", False))
        overlap = float(settings.get("paragraph_overlap", 0.68))
        table_overlap = float(settings.get("table_overlap", 0.90))
    except (TypeError, ValueError):
        return None
    # V21 does not intentionally expand: positive manual targets become 1.0.
    target = max(0.65, min(1.0, target))
    restructure = max(15, min(100, round((lexical + compression) / 2)))
    return LinguisticProfile(
        "manual", "Manual pure-linguistic profile", max(0, min(100, lexical)),
        restructure, target, max(16, min(60, max_words)), contractions,
        max(0.55, min(0.95, overlap)), max(0.75, min(0.98, table_overlap)),
        max(0.10, min(0.38, 0.12 + lexical / 450.0)),
    )


@dataclass
class LinguisticRewriteResult:
    original: str
    rewritten: str
    changed: bool
    accepted: bool
    engine: str
    generator: str
    reasons: List[str]
    metrics: Dict[str, Any]
    protected: Dict[str, Any]


def rewrite_linguistic(
    text: str,
    profile_name: str = "natural",
    *,
    cycle_seed: int = 0,
    table_mode: bool = False,
    user_terms: Sequence[str] | None = None,
    document_glossary: Sequence[str] | None = None,
    style_profile_name: str = "natural_student",
    manual_profile: Mapping[str, Any] | None = None,
) -> LinguisticRewriteResult:
    source = _normalise(text)
    if not source:
        return LinguisticRewriteResult(source, source, False, True, "linguistic_v1", "deterministic_linguistic", [], {}, {"count": 0, "categories": {}, "glossary": []})
    base_profile = profile_from_manual(manual_profile) if profile_name == "manual" else None
    profile = apply_writing_style(base_profile or PROFILES.get(profile_name, PROFILES["natural"]), style_profile_name)
    combined_terms = list(user_terms or []) + list(document_glossary or [])
    registry = build_protected_registry(source, combined_terms, auto_terms=False)
    protected = registry.protect(source)

    sentences = [s.strip() for s in SENTENCE_RE.split(protected) if s.strip()] or [protected]
    rewritten_sentences: List[str] = []
    sentence_metrics: List[Dict[str, Any]] = []
    for index, sentence in enumerate(sentences):
        selected, metrics = _rewrite_protected_sentence(sentence, profile, cycle_seed + index, table_mode)
        rewritten_sentences.append(selected)
        sentence_metrics.append(metrics)

    protected_output = _repair_grammar(" ".join(rewritten_sentences))
    if not registry.placeholders_intact(protected_output):
        return LinguisticRewriteResult(
            source, source, False, True, "linguistic_v1", "deterministic_linguistic",
            ["kept source because a protected item was lost or duplicated"],
            {"candidate_count": sum(m.get("candidate_count", 0) for m in sentence_metrics)}, registry.summary(),
        )
    output = _repair_grammar(registry.restore(protected_output))
    if not registry.verify_restored(output):
        output = source

    final_score, final_metrics = _candidate_score(protected, registry.protect(output), profile, table_mode)
    if final_score <= -1e8:
        output = source
        final_score, final_metrics = _candidate_score(protected, protected, profile, table_mode)

    metrics: Dict[str, Any] = {
        **final_metrics,
        "original_words": _word_count(source),
        "rewritten_words": _word_count(output),
        "word_change": _word_count(output) - _word_count(source),
        "sentence_count_before": _sentence_count(source),
        "sentence_count_after": _sentence_count(output),
        "candidate_count": sum(m.get("candidate_count", 0) for m in sentence_metrics),
        "compression_target": profile.compression_target,
        "profile": profile.name,
        "writing_style": style_profile_name,
        "cycle_seed": cycle_seed,
        "selection_basis": "content preservation + linguistic independence + readability + compression; detector score is not used",
    }
    return LinguisticRewriteResult(
        original=source,
        rewritten=output,
        changed=output != source,
        accepted=True,
        engine="linguistic_v1",
        generator="deterministic_linguistic",
        reasons=[] if output != source else ["no additional safe linguistic transformation was available in this pass"],
        metrics=metrics,
        protected=registry.summary(),
    )


def build_document_glossary(texts: Iterable[str]) -> List[str]:
    return detect_technical_glossary("\n".join(str(x or "") for x in texts))


def profile_info() -> List[Dict[str, Any]]:
    return [asdict(p) for key, p in PROFILES.items() if key in {"light", "natural", "rewrite_compress", "compress", "plain", "strong"}]
