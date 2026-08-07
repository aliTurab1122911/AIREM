from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple

import fitz  # PyMuPDF


_TOKEN_RE = re.compile(r"\S+")


def _normalise_token(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").lower()
    text = (
        text.replace("\u00ad", "")
        .replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("\ufffe", "")
        .replace("\ufffd", "")
    )
    # Keep letters, numbers, underscores, apostrophes, plus signs and internal
    # hyphens. Trimming punctuation makes DOCX and PDF tokenisation comparable.
    text = re.sub(r"^[^\w+'-]+|[^\w+'-]+$", "", text, flags=re.UNICODE)
    return text


def _normalise_filename(value: str) -> str:
    stem = Path(value or "").stem.lower()
    return re.sub(r"[^a-z0-9]+", "", stem)


def _docx_tokens(inventory: Mapping[str, Any]) -> List[Dict[str, Any]]:
    tokens: List[Dict[str, Any]] = []
    for element in sorted(inventory.get("visual_elements", []), key=lambda item: int(item.get("order", 0))):
        text = str(element.get("text") or "")
        visual_id = str(element.get("visual_id") or "")
        for match in _TOKEN_RE.finditer(text):
            norm = _normalise_token(match.group(0))
            if not norm:
                continue
            tokens.append({
                "norm": norm,
                "visual_id": visual_id,
                "start": match.start(),
                "end": match.end(),
                "raw": match.group(0),
            })
    return tokens


def _is_turnitin_highlight(fill: Sequence[float] | None) -> bool:
    if not fill or len(fill) < 3:
        return False
    red, green, blue = (float(fill[0]), float(fill[1]), float(fill[2]))
    # Turnitin AI-writing highlights in exported reports are cyan rectangles.
    # Use a range rather than one exact colour because export versions can vary.
    return (
        red < 0.66
        and green > 0.60
        and blue > 0.66
        and (green - red) > 0.12
        and (blue - red) > 0.15
    )


def _report_metadata(document: fitz.Document) -> Dict[str, Any]:
    first_pages = "\n".join(document[index].get_text("text") for index in range(min(3, document.page_count)))
    filename_match = re.search(r"File\s+Name\s*\n?\s*([^\n]+?\.docx)\b", first_pages, flags=re.IGNORECASE)
    words_match = re.search(r"(?:^|\n)\s*([\d,]+)\s+Words\b", first_pages, flags=re.IGNORECASE)
    score_match = re.search(r"(\d{1,3})%\s+detected\s+as\s+AI", first_pages, flags=re.IGNORECASE)
    submission_match = re.search(r"Submission\s+ID\s*\n?\s*([^\s\n]+)", first_pages, flags=re.IGNORECASE)
    return {
        "reported_filename": filename_match.group(1).strip() if filename_match else "",
        "reported_word_count": int(words_match.group(1).replace(",", "")) if words_match else None,
        "reported_ai_score": int(score_match.group(1)) if score_match else None,
        "submission_id": submission_match.group(1).strip() if submission_match else "",
    }


def _pdf_tokens_and_highlights(pdf_path: str | Path) -> Tuple[List[Dict[str, Any]], int, int]:
    document = fitz.open(str(pdf_path))
    tokens: List[Dict[str, Any]] = []
    highlight_rect_count = 0
    highlighted_page_count = 0

    # The first two pages are Turnitin's cover and AI overview. The submission
    # starts on the third PDF page in standard AI-writing report exports.
    for page_index in range(2, document.page_count):
        page = document[page_index]
        highlight_rects: List[fitz.Rect] = []
        for drawing in page.get_drawings():
            if not _is_turnitin_highlight(drawing.get("fill")):
                continue
            rect = fitz.Rect(drawing.get("rect"))
            if rect.width <= 1 or rect.height <= 1:
                continue
            highlight_rects.append(rect)
            highlight_rect_count += 1
        if highlight_rects:
            highlighted_page_count += 1

        page_height = float(page.rect.height)
        for word in page.get_text("words", sort=True):
            x0, y0, x1, y1, raw, block_no, line_no, word_no = word
            # Strip Turnitin's repeated header and footer while retaining the
            # actual submitted document content.
            if y0 < 45 or y1 > page_height - 45:
                continue
            norm = _normalise_token(str(raw))
            if not norm:
                continue
            word_rect = fitz.Rect(float(x0), float(y0), float(x1), float(y1))
            word_area = max(word_rect.get_area(), 0.001)
            highlighted = False
            for highlight_rect in highlight_rects:
                intersection = word_rect & highlight_rect
                if intersection.get_area() / word_area >= 0.18 or highlight_rect.contains(word_rect.tl + (word_rect.br - word_rect.tl) / 2):
                    highlighted = True
                    break
            tokens.append({
                "norm": norm,
                "raw": str(raw),
                "page": page_index + 1,
                "highlighted": highlighted,
                "block": int(block_no),
                "line": int(line_no),
                "word": int(word_no),
            })
    document.close()
    return tokens, highlight_rect_count, highlighted_page_count


def _extend_punctuation(text: str, start: int, end: int) -> Tuple[int, int]:
    while start > 0 and text[start - 1] in "\"'“‘([":
        start -= 1
    while end < len(text) and text[end] in ".,;:!?)]}\"'’”":
        end += 1
    return start, end


def _build_exact_ranges(
    inventory: Mapping[str, Any],
    doc_tokens: Sequence[Mapping[str, Any]],
    mapped_highlight_pages: Mapping[int, Sequence[int]],
) -> List[Dict[str, Any]]:
    elements = {str(item.get("visual_id")): item for item in inventory.get("visual_elements", [])}
    groups: List[Dict[str, Any]] = []
    previous_doc_index: int | None = None

    for doc_index in sorted(mapped_highlight_pages):
        token = doc_tokens[doc_index]
        visual_id = str(token["visual_id"])
        start = int(token["start"])
        end = int(token["end"])
        pages = set(int(value) for value in mapped_highlight_pages[doc_index])
        if (
            groups
            and groups[-1]["visual_id"] == visual_id
            and previous_doc_index is not None
            and doc_index == previous_doc_index + 1
            and start <= int(groups[-1]["end"]) + 3
        ):
            groups[-1]["end"] = max(int(groups[-1]["end"]), end)
            groups[-1]["pages"].update(pages)
        else:
            groups.append({
                "visual_id": visual_id,
                "start": start,
                "end": end,
                "pages": pages,
            })
        previous_doc_index = doc_index

    result: List[Dict[str, Any]] = []
    for group in groups:
        element = elements.get(group["visual_id"])
        if not element:
            continue
        text = str(element.get("text") or "")
        start, end = _extend_punctuation(text, int(group["start"]), int(group["end"]))
        fragment = text[start:end]
        if not fragment.strip():
            continue
        result.append({
            "start_id": group["visual_id"],
            "start_offset": start,
            "end_id": group["visual_id"],
            "end_offset": end,
            "source": "turnitin",
            "pdf_pages": sorted(group["pages"]),
            "preview": fragment[:180],
        })
    return result


def _build_expanded_ranges(inventory: Mapping[str, Any], exact_ranges: Sequence[Mapping[str, Any]]) -> Tuple[List[Dict[str, Any]], int, int]:
    elements = sorted(inventory.get("visual_elements", []), key=lambda item: int(item.get("order", 0)))
    by_id = {str(item.get("visual_id")): item for item in elements}
    paragraph_ids: set[str] = set()
    table_indexes: set[int] = set()

    for item in exact_ranges:
        element = by_id.get(str(item.get("start_id") or ""))
        if not element:
            continue
        location = element.get("location") or {}
        if location.get("kind") == "paragraph":
            paragraph_ids.add(str(element.get("visual_id")))
        elif location.get("kind") == "table_cell_paragraph":
            table_indexes.add(int(location.get("table_index")))

    expanded: List[Dict[str, Any]] = []
    for visual_id in sorted(paragraph_ids, key=lambda value: int(by_id[value].get("order", 0))):
        text = str(by_id[visual_id].get("text") or "")
        if text.strip():
            expanded.append({
                "start_id": visual_id,
                "start_offset": 0,
                "end_id": visual_id,
                "end_offset": len(text),
                "source": "turnitin-expanded",
                "preview": text[:180],
            })

    for table_index in sorted(table_indexes):
        table_elements = [
            item for item in elements
            if (item.get("location") or {}).get("kind") == "table_cell_paragraph"
            and int((item.get("location") or {}).get("table_index", -1)) == table_index
            and str(item.get("text") or "").strip()
        ]
        if not table_elements:
            continue
        first = table_elements[0]
        last = table_elements[-1]
        expanded.append({
            "start_id": str(first.get("visual_id")),
            "start_offset": 0,
            "end_id": str(last.get("visual_id")),
            "end_offset": len(str(last.get("text") or "")),
            "source": "turnitin-expanded",
            "preview": f"Entire table {table_index + 1}",
            "table_index": table_index,
        })

    expanded.sort(key=lambda item: int(by_id[str(item["start_id"])].get("order", 0)))
    return expanded, len(paragraph_ids), len(table_indexes)


def analyse_turnitin_report(
    original_docx_path: str | Path,
    original_filename: str,
    inventory: Mapping[str, Any],
    report_pdf_path: str | Path,
) -> Dict[str, Any]:
    """Verify a Turnitin AI-writing report and map its cyan highlights to DOCX spans."""
    pdf_document = fitz.open(str(report_pdf_path))
    metadata = _report_metadata(pdf_document)
    page_count = pdf_document.page_count
    pdf_document.close()

    doc_tokens = _docx_tokens(inventory)
    pdf_tokens, highlight_rect_count, highlighted_page_count = _pdf_tokens_and_highlights(report_pdf_path)

    matcher = SequenceMatcher(
        None,
        [item["norm"] for item in pdf_tokens],
        [item["norm"] for item in doc_tokens],
        autojunk=False,
    )
    pdf_to_doc: Dict[int, int] = {}
    matched_tokens = 0
    for pdf_start, doc_start, size in matcher.get_matching_blocks():
        matched_tokens += int(size)
        for offset in range(size):
            pdf_to_doc[pdf_start + offset] = doc_start + offset

    shortest_count = min(len(pdf_tokens), len(doc_tokens)) or 1
    content_similarity = matched_tokens / shortest_count
    sequence_similarity = matcher.ratio()
    reported_filename = str(metadata.get("reported_filename") or "")
    filename_match = bool(
        reported_filename
        and _normalise_filename(reported_filename) == _normalise_filename(original_filename)
    )

    if content_similarity >= 0.90:
        verification_status = "verified"
        verification_message = "The Turnitin submission text matches the uploaded DOCX. Highlight mapping is enabled."
    elif content_similarity >= 0.75:
        verification_status = "review"
        verification_message = "The files are similar, but not close enough for automatic mapping. Confirm that the report was generated from this exact DOCX."
    else:
        verification_status = "mismatch"
        verification_message = "The Turnitin report does not match the uploaded DOCX closely enough. Automatic mapping is disabled."

    highlighted_pdf_tokens = [index for index, item in enumerate(pdf_tokens) if bool(item.get("highlighted"))]
    mapped_highlight_pages: Dict[int, List[int]] = defaultdict(list)
    for pdf_index in highlighted_pdf_tokens:
        doc_index = pdf_to_doc.get(pdf_index)
        if doc_index is not None:
            mapped_highlight_pages[doc_index].append(int(pdf_tokens[pdf_index]["page"]))

    exact_ranges = _build_exact_ranges(inventory, doc_tokens, mapped_highlight_pages)
    expanded_ranges, expanded_paragraph_count, expanded_table_count = _build_expanded_ranges(inventory, exact_ranges)
    mapped_highlight_count = len(mapped_highlight_pages)
    highlight_mapping_coverage = mapped_highlight_count / max(len(highlighted_pdf_tokens), 1)

    mapping_enabled = (
        verification_status == "verified"
        and bool(exact_ranges)
        and highlight_mapping_coverage >= 0.80
    )
    if verification_status == "verified" and not highlighted_pdf_tokens:
        verification_message = "The Turnitin submission text matches the uploaded DOCX, but no cyan AI-writing highlights were detected in the report."
    elif verification_status == "verified" and not mapping_enabled:
        verification_message = "The Turnitin submission text matches the uploaded DOCX, but the highlighted passages could not be mapped with sufficient coverage for automatic selection."

    # Mapping data is retained for diagnostics even for mismatches, but the UI
    # only enables one-click mapping after verification and coverage checks.
    return {
        "verification_status": verification_status,
        "verification_message": verification_message,
        "filename_match": filename_match,
        "original_filename": original_filename,
        "reported_filename": reported_filename,
        "reported_word_count": metadata.get("reported_word_count"),
        "reported_ai_score": metadata.get("reported_ai_score"),
        "submission_id": metadata.get("submission_id"),
        "page_count": page_count,
        "docx_token_count": len(doc_tokens),
        "report_token_count": len(pdf_tokens),
        "matched_token_count": matched_tokens,
        "content_similarity": round(content_similarity, 4),
        "sequence_similarity": round(sequence_similarity, 4),
        "highlight_rectangle_count": highlight_rect_count,
        "highlighted_page_count": highlighted_page_count,
        "highlighted_report_token_count": len(highlighted_pdf_tokens),
        "mapped_highlight_token_count": mapped_highlight_count,
        "highlight_mapping_coverage": round(highlight_mapping_coverage, 4),
        "exact_ranges": exact_ranges,
        "exact_range_count": len(exact_ranges),
        "expanded_ranges": expanded_ranges,
        "expanded_range_count": len(expanded_ranges),
        "expanded_paragraph_count": expanded_paragraph_count,
        "expanded_table_count": expanded_table_count,
        "mapping_enabled": mapping_enabled,
    }
