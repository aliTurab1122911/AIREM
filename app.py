from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request, send_file, url_for
from werkzeug.utils import secure_filename

from dotenv import load_dotenv

from scripts.docx_pipeline_common import load_map, parse_extract_text, save_json, sections_to_text
from scripts.local_rewriter import (
    build_manual_profile,
    get_profile,
    list_profiles,
    rewrite_chunk_with_mapping,
    serialise_manual_profile,
)
from scripts.pipeline_engine import (
    create_extraction_package,
    create_extraction_package_from_sections,
    reinsert_sections,
    validate_edited_chunks,
)
from scripts.style_score import original_chunk_texts
from scripts.detection_service import detect_document_mapping, detect_docx, detect_text
from scripts.document_selector import (
    analyse_document_blocks, resolve_selected_ids, sections_from_selected_blocks,
    sections_from_visual_ranges,
)
from scripts.formatting_service import analyse_document_formatting, apply_document_formatting
from scripts.text_rewriter_service import rewrite_pasted_text
from scripts.turnitin_mapper import analyse_turnitin_report
from scripts.openai_edit_service import (
    build_edit_items, edit_ranges_with_openai, manual_edit_drafts, openai_configuration,
)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
WORKSPACE = BASE_DIR / "workspace"
WORKSPACE.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB


def job_dir(job_id: str) -> Path:
    return WORKSPACE / job_id


def get_job(job_id: str) -> Dict:
    path = job_dir(job_id) / "job.json"
    if not path.exists():
        raise FileNotFoundError("Job not found")
    return load_map(path)


def save_job(job_id: str, data: Dict) -> None:
    save_json(data, job_dir(job_id) / "job.json")


def turnitin_context(job: Dict[str, Any]) -> Dict[str, Any] | None:
    analysis_path = Path(str(job.get("turnitin_analysis_path") or ""))
    pdf_relative = str(job.get("turnitin_pdf_relative") or "")
    if not analysis_path.exists() or not pdf_relative:
        return None
    analysis = load_map(analysis_path)
    analysis["pdf_url"] = url_for("preview_file", job_id=job["job_id"], filename=pdf_relative)
    analysis["download_url"] = url_for("download_file", job_id=job["job_id"], filename=pdf_relative)
    return analysis


def render_range_page(job: Dict[str, Any], inventory: Dict[str, Any], **context):
    """Render the selector with shared Turnitin and OpenAI configuration context."""
    return render_template(
        "range_selector.html",
        job=job,
        inventory=inventory,
        turnitin=turnitin_context(job),
        openai=openai_configuration(),
        **context,
    )


def _edit_session_path(job: Dict[str, Any], session_id: str) -> Path:
    clean = "".join(ch for ch in str(session_id) if ch.isalnum() or ch in {"-", "_"})
    if not clean or clean != str(session_id):
        raise ValueError("Invalid edit session identifier.")
    root = Path(job["logs_dir"]) / "range_edit_sessions"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{clean}.json"


def _load_edit_session(job: Dict[str, Any], session_id: str) -> Dict[str, Any]:
    path = _edit_session_path(job, session_id)
    if not path.exists():
        raise FileNotFoundError("The range edit session was not found. Generate or prepare drafts again.")
    return load_map(path)


def _replacement_texts(session: Dict[str, Any], payload: Dict[str, Any]) -> list[str]:
    raw = payload.get("edits")
    if not isinstance(raw, list):
        raise ValueError("Edited range values are required.")
    supplied = {
        str(item.get("id") or ""): str(item.get("revised_text") if item.get("revised_text") is not None else "")
        for item in raw if isinstance(item, dict)
    }
    replacements: list[str] = []
    for item in session.get("edits", []):
        edit_id = str(item.get("id") or "")
        if edit_id not in supplied:
            raise ValueError(f"Missing revised text for {edit_id or 'a selected range'}.")
        replacements.append(supplied[edit_id])
    return replacements


def normalise_edited_texts(payload: Any) -> Dict[int, str]:
    """Return a safe integer-keyed edited-text mapping from a JSON payload.

    Validation reports should diagnose missing or empty chunks rather than fail
    with an unrelated JSON/key conversion error.
    """
    if not isinstance(payload, dict):
        return {}
    raw = payload.get("edited_texts")
    if not isinstance(raw, dict):
        return {}

    edited_texts: Dict[int, str] = {}
    for key, value in raw.items():
        try:
            chunk_number = int(key)
        except (TypeError, ValueError):
            continue
        edited_texts[chunk_number] = "" if value is None else str(value)
    return edited_texts


def repair_chunk_to_expected_lines(original_text: str, edited_text: str):
    """Return edited text with exact original section/line counts.

    This is the last safety net before validation. If the API output has merged,
    deleted, split, or added lines inside a section, the affected section is
    reverted to the original extracted section so DOCX reinsertion remains safe.
    """
    original_sections = parse_extract_text(original_text)
    edited_sections = parse_extract_text(edited_text)
    fixed_sections = []
    repairs = []
    for idx, original_section in enumerate(original_sections):
        edited_section = edited_sections[idx] if idx < len(edited_sections) else []
        if len(edited_section) == len(original_section):
            fixed_sections.append(edited_section)
        else:
            fixed_sections.append(original_section)
            repairs.append({
                "section_number": idx + 1,
                "expected_lines": len(original_section),
                "actual_lines": len(edited_section),
                "action": "reverted_to_original_for_structure_safety",
            })
    if len(edited_sections) > len(original_sections):
        repairs.append({
            "section_number": "extra_sections_removed",
            "expected_sections": len(original_sections),
            "actual_sections": len(edited_sections),
            "action": "removed_extra_sections_for_structure_safety",
        })
    return sections_to_text(fixed_sections), repairs


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/document-rewriter")
def document_rewriter():
    return render_template("document_upload.html")


@app.post("/upload")
def upload():
    """Upload a DOCX and display its selectable block inventory."""
    uploaded = request.files.get("docx_file")
    if not uploaded or uploaded.filename == "":
        return render_template("document_upload.html", error="Upload a .docx file first."), 400
    if not uploaded.filename.lower().endswith(".docx"):
        return render_template("document_upload.html", error="Only .docx files are supported."), 400

    try:
        max_words = int(request.form.get("max_words") or 4500)
    except ValueError:
        max_words = 4500
    max_words = max(500, min(max_words, 5000))

    job_id = str(uuid.uuid4())
    root = job_dir(job_id)
    input_dir = root / "1_org"
    extract_dir = root / "2_extract"
    output_dir = root / "4_org_fin"
    logs_dir = root / "logs"
    for folder in [input_dir, extract_dir, output_dir, logs_dir]:
        folder.mkdir(parents=True, exist_ok=True)

    safe_name = secure_filename(uploaded.filename) or "input.docx"
    original_path = input_dir / safe_name
    uploaded.save(original_path)

    try:
        inventory = analyse_document_blocks(original_path)
    except Exception as exc:
        return render_template("document_upload.html", error=f"The DOCX could not be analysed: {exc}"), 400

    inventory_path = logs_dir / "document_inventory.json"
    save_json(inventory, inventory_path)
    map_path = logs_dir / "extraction_map.json"
    job = {
        "job_id": job_id,
        "job_type": "document_rewrite",
        "original_filename": safe_name,
        "original_path": str(original_path),
        "extract_dir": str(extract_dir),
        "output_dir": str(output_dir),
        "logs_dir": str(logs_dir),
        "map_path": str(map_path),
        "inventory_path": str(inventory_path),
        "max_words": max_words,
        "final_path": "",
        "rewrite_cycle_count": 0,
        "rewrite_pass_count": 0,
        "style_score_history": [],
    }
    save_job(job_id, job)
    return render_range_page(job, inventory)


@app.post("/turnitin/upload/<job_id>")
def turnitin_upload(job_id: str):
    """Attach, verify and map a Turnitin AI-writing PDF to the uploaded DOCX."""
    job = get_job(job_id)
    inventory = load_map(job["inventory_path"])
    uploaded = request.files.get("turnitin_pdf")
    if not uploaded or not uploaded.filename:
        return render_range_page(job, inventory, error="Choose the Turnitin AI-writing PDF first."), 400
    if not uploaded.filename.lower().endswith(".pdf"):
        return render_range_page(job, inventory, error="Only Turnitin PDF reports are supported."), 400

    report_dir = job_dir(job_id) / "turnitin"
    report_dir.mkdir(parents=True, exist_ok=True)
    safe_name = secure_filename(uploaded.filename) or "turnitin_report.pdf"
    pdf_path = report_dir / safe_name
    uploaded.save(pdf_path)
    try:
        with pdf_path.open("rb") as handle:
            if handle.read(5) != b"%PDF-":
                raise ValueError("The uploaded file is not a valid PDF.")
        analysis = analyse_turnitin_report(
            original_docx_path=job["original_path"],
            original_filename=job["original_filename"],
            inventory=inventory,
            report_pdf_path=pdf_path,
        )
    except Exception as exc:
        try:
            pdf_path.unlink()
        except OSError:
            pass
        return render_range_page(job, inventory, error=f"The Turnitin report could not be analysed: {exc}"), 400

    analysis["uploaded_report_filename"] = safe_name
    analysis_path = Path(job["logs_dir"]) / "turnitin_mapping.json"
    save_json(analysis, analysis_path)
    job["turnitin_analysis_path"] = str(analysis_path)
    job["turnitin_pdf_relative"] = str(pdf_path.relative_to(job_dir(job_id))).replace("\\", "/")
    save_job(job_id, job)
    return render_range_page(job, inventory)


@app.post("/create-extract/<job_id>")
def create_extract(job_id: str):
    job = get_job(job_id)
    inventory = load_map(job["inventory_path"])
    mode = str(request.form.get("selection_mode") or "automatic")
    manual_ids = request.form.getlist("selected_blocks")
    try:
        start_order = int(request.form.get("start_order")) if request.form.get("start_order") not in (None, "") else None
        end_order = int(request.form.get("end_order")) if request.form.get("end_order") not in (None, "") else None
    except ValueError:
        start_order = end_order = None
    include_headings = request.form.get("include_headings") == "on"
    include_captions = request.form.get("include_captions") == "on"
    include_table_headers = request.form.get("include_table_headers") == "on"

    visual_ranges = []
    if mode == "visual":
        try:
            visual_ranges = json.loads(request.form.get("visual_ranges_json") or "[]")
        except json.JSONDecodeError:
            visual_ranges = []
        if not isinstance(visual_ranges, list):
            visual_ranges = []
        selected_ids = []
        sections = sections_from_visual_ranges(job["original_path"], inventory, visual_ranges)
    else:
        selected_ids = resolve_selected_ids(
            inventory,
            mode=mode,
            manual_ids=manual_ids,
            start_order=start_order,
            end_order=end_order,
            include_headings=include_headings,
            include_captions=include_captions,
        )
        if not selected_ids:
            return render_range_page(
                job, inventory,
                error="No editable content was selected. Adjust the range or select at least one paragraph/table.",
            ), 400
        sections = sections_from_selected_blocks(
            job["original_path"],
            selected_ids,
            include_table_headers=include_table_headers,
        )
    if not sections:
        return render_range_page(
            job, inventory, error="The selected blocks did not contain reinsertable text."
        ), 400

    mapping = create_extraction_package_from_sections(
        input_path=job["original_path"],
        sections=sections,
        output_dir=job["extract_dir"],
        map_path=job["map_path"],
        max_words=int(job["max_words"]),
        selection_metadata={
            "mode": mode,
            "selected_block_ids": selected_ids,
            "selected_block_count": len(selected_ids),
            "visual_ranges": visual_ranges,
            "visual_range_count": len(visual_ranges),
            "include_headings": include_headings,
            "include_captions": include_captions,
            "include_table_headers": include_table_headers,
            "start_order": start_order,
            "end_order": end_order,
        },
    )
    job["selected_block_count"] = len(selected_ids) if mode != "visual" else len(visual_ranges)
    job["selection_mode"] = mode
    job["visual_range_count"] = len(visual_ranges)
    save_job(job_id, job)
    return render_template("workspace.html", job=job, mapping=mapping)


@app.post("/api/range-edit/<job_id>/draft")
def range_edit_draft(job_id: str):
    """Prepare manual drafts or generate OpenAI edits for the saved visual ranges."""
    job = get_job(job_id)
    inventory = load_map(job["inventory_path"])
    payload = request.get_json(silent=True) or {}
    visual_ranges = payload.get("visual_ranges")
    if not isinstance(visual_ranges, list):
        return jsonify({"ok": False, "message": "Saved visual ranges are required."}), 400
    sections = sections_from_visual_ranges(job["original_path"], inventory, visual_ranges)
    items = build_edit_items(sections, inventory)
    manual_only = bool(payload.get("manual_only"))
    prompt = str(payload.get("prompt") or "").strip()
    model = str(payload.get("model") or "").strip() or None
    try:
        result = manual_edit_drafts(items) if manual_only else edit_ranges_with_openai(items, prompt, model)
    except (ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400

    session_id = str(uuid.uuid4())
    session = {
        "session_id": session_id,
        "job_id": job_id,
        "mode": "manual" if manual_only else "openai",
        "prompt": prompt,
        "model": result.get("model"),
        "response_id": result.get("response_id"),
        "response_ids": result.get("response_ids", []),
        "usage": result.get("usage"),
        "batch_count": int(result.get("batch_count") or 0),
        "batch_item_limit": result.get("batch_item_limit"),
        "batch_summaries": result.get("batch_summaries", []),
        "visual_ranges": visual_ranges,
        "sections": sections,
        "edits": result["edits"],
    }
    save_json(session, _edit_session_path(job, session_id))
    return jsonify({
        "ok": True,
        "session_id": session_id,
        "mode": session["mode"],
        "model": session.get("model"),
        "usage": session.get("usage"),
        "batch_count": session.get("batch_count", 0),
        "batch_item_limit": session.get("batch_item_limit"),
        "edits": session["edits"],
    })


@app.post("/api/range-edit/<job_id>/export")
def range_edit_export(job_id: str):
    """Reinsert approved range edits directly into a new DOCX."""
    job = get_job(job_id)
    payload = request.get_json(silent=True) or {}
    try:
        session = _load_edit_session(job, str(payload.get("session_id") or ""))
        replacements = _replacement_texts(session, payload)
    except (ValueError, FileNotFoundError) as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400

    stem = Path(job["original_filename"]).stem
    session_tag = str(session["session_id"])[:8]
    output_name = f"{stem}_approved_range_edits_{session_tag}.docx"
    output_path = Path(job["output_dir"]) / output_name
    log_name = f"direct_range_edit_reinsertion_{session_tag}.json"
    log_path = Path(job["logs_dir"]) / log_name
    mapping = {"sections": session.get("sections", [])}
    parsed_sections = [[text] for text in replacements]
    try:
        result = reinsert_sections(job["original_path"], mapping, parsed_sections, output_path, log_path)
    except Exception as exc:
        return jsonify({"ok": False, "message": f"Direct reinsertion failed: {exc}"}), 400
    return jsonify({
        "ok": True,
        "replacement_count": result["replacement_count"],
        "download_url": url_for("download_file", job_id=job_id, filename=f"4_org_fin/{output_name}"),
        "log_url": url_for("download_file", job_id=job_id, filename=f"logs/{log_name}"),
    })


@app.post("/api/range-edit/<job_id>/continue")
def range_edit_continue(job_id: str):
    """Use approved range edits as the prefilled source for the normal AIREM workspace."""
    job = get_job(job_id)
    payload = request.get_json(silent=True) or {}
    try:
        session = _load_edit_session(job, str(payload.get("session_id") or ""))
        replacements = _replacement_texts(session, payload)
    except (ValueError, FileNotFoundError) as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400

    sections = list(session.get("sections") or [])
    mapping = create_extraction_package_from_sections(
        input_path=job["original_path"],
        sections=sections,
        output_dir=job["extract_dir"],
        map_path=job["map_path"],
        max_words=int(job["max_words"]),
        selection_metadata={
            "mode": "approved_range_edits",
            "range_edit_session_id": session["session_id"],
            "range_edit_mode": session.get("mode"),
            "visual_ranges": session.get("visual_ranges", []),
        },
    )
    edited_texts: Dict[int, str] = {}
    for chunk in mapping["chunks"]:
        lines = [[replacements[index]] for index in chunk["section_indices"]]
        edited_texts[int(chunk["chunk_number"])] = sections_to_text(lines)
    prefill_path = Path(job["logs_dir"]) / "prefill_approved_range_edits.json"
    save_json({"edited_texts": edited_texts}, prefill_path)
    job["prefill_edited_texts_path"] = str(prefill_path)
    job["selected_block_count"] = len(sections)
    job["selection_mode"] = "approved_range_edits"
    job["visual_range_count"] = len(session.get("visual_ranges", []))
    save_job(job_id, job)
    return jsonify({"ok": True, "redirect_url": url_for("show_job", job_id=job_id)})


@app.get("/text-rewriter")
def text_rewriter_page():
    return render_template("text_rewriter.html")


@app.post("/api/text/rewrite")
def text_rewriter_api():
    payload = request.get_json(silent=True) or {}
    try:
        result = rewrite_pasted_text(
            text=str(payload.get("text") or ""),
            profile_name=str(payload.get("profile") or "natural"),
            manual_settings=payload.get("manual_settings") if isinstance(payload.get("manual_settings"), dict) else None,
            preserve_line_breaks=bool(payload.get("preserve_line_breaks", True)),
            engine=str(payload.get("engine") or "linguistic"),
            style_profile=str(payload.get("style_profile") or "natural_student"),
            cycle_seed=int(payload.get("cycle_seed") or 0),
            protected_terms=payload.get("protected_terms") if isinstance(payload.get("protected_terms"), list) else None,
        )
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    return jsonify(result)


@app.get("/detector")
def detector_page():
    return render_template("detector.html")


@app.post("/api/detect-text")
def detect_text_api():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "")
    if not text.strip():
        return jsonify({"ok": False, "message": "Paste text before running detection."}), 400
    report = detect_text(text, table_mode=False, include_passages=True)
    return jsonify({"ok": True, "report": report})


@app.post("/api/detect-file")
def detect_file_api():
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"ok": False, "message": "Choose a DOCX or TXT file first."}), 400
    suffix = Path(uploaded.filename).suffix.lower()
    if suffix not in {".docx", ".txt"}:
        return jsonify({"ok": False, "message": "Only .docx and .txt files are supported."}), 400
    temp_dir = WORKSPACE / "detector_uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = temp_dir / f"{uuid.uuid4()}{suffix}"
    uploaded.save(temp_path)
    try:
        if suffix == ".docx":
            report = detect_docx(temp_path)
        else:
            text = temp_path.read_text(encoding="utf-8", errors="replace")
            report = detect_text(text, include_passages=True)
        return jsonify({"ok": True, "filename": uploaded.filename, "report": report})
    finally:
        try:
            temp_path.unlink()
        except OSError:
            pass


@app.get("/formatting")
def formatting_page():
    return render_template("formatting_upload.html")


@app.post("/formatting/analyse")
def formatting_analyse():
    uploaded = request.files.get("docx_file")
    if not uploaded or not uploaded.filename:
        return render_template("formatting_upload.html", error="Upload a .docx file first."), 400
    if not uploaded.filename.lower().endswith(".docx"):
        return render_template("formatting_upload.html", error="Only .docx files are supported."), 400

    job_id = str(uuid.uuid4())
    root = job_dir(job_id)
    input_dir = root / "1_org"
    output_dir = root / "formatted"
    logs_dir = root / "logs"
    for folder in [input_dir, output_dir, logs_dir]:
        folder.mkdir(parents=True, exist_ok=True)
    safe_name = secure_filename(uploaded.filename) or "input.docx"
    original_path = input_dir / safe_name
    uploaded.save(original_path)
    try:
        report = analyse_document_formatting(original_path)
        preview = analyse_document_blocks(original_path)
    except Exception as exc:
        return render_template("formatting_upload.html", error=f"The DOCX could not be analysed: {exc}"), 400
    report_path = logs_dir / "formatting_analysis.json"
    preview_path = logs_dir / "formatting_preview.json"
    save_json(report, report_path)
    save_json(preview, preview_path)
    job = {
        "job_id": job_id,
        "job_type": "formatting",
        "original_filename": safe_name,
        "original_path": str(original_path),
        "output_dir": str(output_dir),
        "logs_dir": str(logs_dir),
        "report_path": str(report_path),
        "preview_path": str(preview_path),
    }
    save_job(job_id, job)
    return render_template("formatting_workspace.html", job=job, report=report, preview=preview)


@app.post("/formatting/apply/<job_id>")
def formatting_apply(job_id: str):
    job = get_job(job_id)
    options = {key: value for key, value in request.form.items()}
    for name in ["convert_captions", "page_numbers", "add_toc", "add_lof", "add_lot", "repeat_header", "bold_table_header", "page_border", "different_first_page"]:
        options[name] = request.form.get(name) == "on"
    output_name = f"{Path(job['original_filename']).stem}_formatted.docx"
    output_path = Path(job["output_dir"]) / output_name
    try:
        result = apply_document_formatting(job["original_path"], output_path, options)
    except Exception as exc:
        report = load_map(job["report_path"])
        preview = load_map(job["preview_path"]) if job.get("preview_path") else analyse_document_blocks(job["original_path"])
        return render_template("formatting_workspace.html", job=job, report=report, preview=preview, error=f"Formatting failed: {exc}"), 400
    result_path = Path(job["logs_dir"]) / "formatting_result.json"
    save_json(result, result_path)
    return render_template(
        "formatting_result.html",
        job=job,
        result=result,
        download_url=url_for("download_file", job_id=job_id, filename=f"formatted/{output_name}"),
        report_url=url_for("download_file", job_id=job_id, filename="logs/formatting_result.json"),
    )


@app.get("/job/<job_id>")
def show_job(job_id: str):
    job = get_job(job_id)
    if job.get("job_type") == "formatting":
        report = load_map(job["report_path"])
        preview = load_map(job["preview_path"]) if job.get("preview_path") else analyse_document_blocks(job["original_path"])
        return render_template("formatting_workspace.html", job=job, report=report, preview=preview)
    map_path = Path(job.get("map_path") or "")
    if map_path.exists():
        mapping = load_map(map_path)
        prefill = {}
        prefill_value = str(job.get("prefill_edited_texts_path") or "").strip()
        if prefill_value:
            prefill_path = Path(prefill_value)
            if prefill_path.exists() and prefill_path.is_file():
                raw_prefill = load_map(prefill_path).get("edited_texts", {})
                prefill = {int(k): str(v) for k, v in raw_prefill.items()}
        return render_template(
            "workspace.html", job=job, mapping=mapping,
            prefill_edited_texts=prefill,
        )
    inventory = load_map(job["inventory_path"])
    return render_range_page(job, inventory)


@app.get("/preview/<job_id>/<path:filename>")
def preview_file(job_id: str, filename: str):
    root = job_dir(job_id).resolve()
    target = (root / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return "File not found", 404
    if not target.exists() or not target.is_file():
        return "File not found", 404
    return send_file(target, as_attachment=False, conditional=True)


@app.get("/download/<job_id>/<path:filename>")
def download_file(job_id: str, filename: str):
    root = job_dir(job_id).resolve()
    target = (root / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return "File not found", 404
    if not target.exists() or not target.is_file():
        return "File not found", 404
    return send_file(target, as_attachment=True)


@app.post("/validate/<job_id>")
def validate(job_id: str):
    job = get_job(job_id)
    mapping = load_map(job["map_path"])
    payload = request.get_json(silent=True) or {}
    edited_texts = normalise_edited_texts(payload)
    report = validate_edited_chunks(mapping, edited_texts)
    parsed_sections = report.pop("parsed_sections", [])
    report_path = Path(job["logs_dir"]) / "validation_report.json"
    report["validation_report_url"] = url_for("download_file", job_id=job_id, filename="logs/validation_report.json")
    report["can_reinsert"] = report["valid"]
    save_json(report, report_path)
    # Save valid parsed sections for later reinsertion only if the submitted content is valid.
    if report["valid"]:
        save_json({"parsed_sections": parsed_sections}, Path(job["logs_dir"]) / "latest_valid_edited_sections.json")
    return jsonify(report)


@app.get("/rewrite/profiles")
def rewrite_profiles():
    return jsonify({"profiles": list_profiles()})


@app.post("/style-score/<job_id>")
def style_score(job_id: str):
    """Calculate the V3 experimental writing-pattern score.

    The report is used for candidate comparison after structural and factual
    safeguards. It does not establish authorship.
    """
    job = get_job(job_id)
    mapping = load_map(job["map_path"])
    payload = request.get_json(silent=True) or {}

    initial = detect_document_mapping(mapping, original_chunk_texts(mapping))
    raw_current = payload.get("edited_texts")
    current = None
    if isinstance(raw_current, dict) and raw_current:
        current_texts = {int(k): str(v) for k, v in raw_current.items()}
        report = validate_edited_chunks(mapping, current_texts)
        report.pop("parsed_sections", None)
        if not report["valid"]:
            return jsonify({
                "ok": False,
                "message": "The current edited text must preserve the extraction structure before it can be scored.",
                "validation": report,
                "initial": initial,
            }), 400
        current = detect_document_mapping(mapping, current_texts)

    history = list(job.get("style_score_history") or [])
    return jsonify({
        "ok": True,
        "initial": initial,
        "current": current,
        "delta_from_initial": round(current["ai_style_score"] - initial["ai_style_score"], 1) if current else None,
        "history": history,
        "disclaimer": initial["disclaimer"],
    })


@app.post("/rewrite/<job_id>")
def rewrite(job_id: str):
    """Rewrite the original extracted text with the selected profile."""
    payload = request.get_json(silent=True) or {}
    return _run_rewrite(job_id, payload, cycle=False)


@app.post("/rewrite-cycle/<job_id>")
def rewrite_cycle(job_id: str):
    """Run another rewrite pass using the current edited text as its source.

    The client sends the text currently shown in every editor. It is validated
    against the fixed extraction map before the next pass starts. The rewritten
    result keeps the same section and line structure, so the cycle may be run
    repeatedly and can still be reinserted into the original DOCX.
    """
    payload = request.get_json(silent=True) or {}
    return _run_rewrite(job_id, payload, cycle=True)


def _resolve_rewrite_profile(payload: Dict):
    profile = str(payload.get("profile") or "natural").strip().lower()
    allowed_profiles = {item["name"] for item in list_profiles()} | {"manual"}
    if profile not in allowed_profiles:
        profile = "natural"

    manual_profile = None
    manual_settings = {}
    if profile == "manual":
        manual_settings = payload.get("manual_settings") or {}
        if not isinstance(manual_settings, dict):
            manual_settings = {}
        manual_profile = build_manual_profile(manual_settings)
    return profile, manual_profile, manual_settings


def _run_rewrite(job_id: str, payload: Dict, cycle: bool):
    """Run one pure-Python linguistic rewrite pass.

    Rewrite cycles are unlimited and there is no quality/detection rollback.
    The only fallback is structural/factual safety: a pass that breaks the fixed
    extraction map cannot replace the current text. Detector scores are computed
    after the pass for display only and never influence candidate selection.
    """
    job = get_job(job_id)
    mapping = load_map(job["map_path"])
    profile, manual_profile, manual_settings = _resolve_rewrite_profile(payload)
    engine_name = str(payload.get("engine") or "linguistic").strip().lower()
    if engine_name not in {"linguistic", "legacy"}:
        engine_name = "linguistic"
    style_profile_name = str(payload.get("style_profile") or "natural_student").strip().lower()
    protected_terms = payload.get("protected_terms") if isinstance(payload.get("protected_terms"), list) else []

    original_texts = original_chunk_texts(mapping)
    source_texts: Dict[int, str] = original_texts
    if cycle:
        raw_source = payload.get("edited_texts") or {}
        if not isinstance(raw_source, dict):
            return jsonify({"ok": False, "message": "Current edited text is required for a rewrite cycle."}), 400
        source_texts = {int(k): str(v) for k, v in raw_source.items()}
        source_validation = validate_edited_chunks(mapping, source_texts)
        source_validation.pop("parsed_sections", None)
        if not source_validation["valid"]:
            return jsonify({
                "ok": False,
                "message": "The current edited text must preserve the extraction structure before another cycle can run.",
                "validation": source_validation,
            }), 400

    initial_score = detect_document_mapping(mapping, original_texts)
    source_score = detect_document_mapping(mapping, source_texts)
    cycle_number = (int(job.get("rewrite_cycle_count") or 0) + 1) if cycle else 0
    cycle_seed = cycle_number

    attempted_texts: Dict[int, str] = {}
    chunk_logs = []
    try:
        for chunk in mapping["chunks"]:
            n = int(chunk["chunk_number"])
            source_text = source_texts.get(n) if cycle else None
            result = rewrite_chunk_with_mapping(
                mapping,
                chunk,
                profile_name=profile,
                profile_override=manual_profile,
                source_text=source_text,
                engine_name=engine_name,
                style_profile_name=style_profile_name,
                cycle_seed=cycle_seed,
                protected_terms=protected_terms,
            )
            expected_text = source_text if source_text is not None else chunk["text"]
            safe_text, repairs = repair_chunk_to_expected_lines(expected_text, result["text"])
            attempted_texts[n] = safe_text
            chunk_logs.append({
                "chunk_number": n,
                "summary": result["summary"],
                "lines": result["logs"],
                "structure_repairs": repairs,
            })
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400

    attempted_validation = validate_edited_chunks(mapping, attempted_texts)
    attempted_validation.pop("parsed_sections", None)
    attempted_score = detect_document_mapping(mapping, attempted_texts)

    # No score/quality rollback in V21. Only a broken reinsertion structure can
    # trigger a safety fallback to the current source text.
    pass_accepted = bool(attempted_validation["valid"])
    rollback_reason = None
    if pass_accepted:
        edited_texts = attempted_texts
        output_score = attempted_score
    else:
        edited_texts = dict(source_texts)
        output_score = source_score
        rollback_reason = "structural_safety_fallback"

    validation = validate_edited_chunks(mapping, edited_texts)
    parsed_sections = validation.pop("parsed_sections", [])

    original_words = max(int(initial_score.get("word_count") or 0), 1)
    source_words = int(source_score.get("word_count") or 0)
    output_words = int(output_score.get("word_count") or 0)
    final_budget = {
        "original_words": original_words,
        "source_words": source_words,
        "output_words": output_words,
        "target_words": original_words,
        "hard_max_words": None,
        "source_change_percent": round((source_words / original_words - 1.0) * 100.0, 2),
        "output_change_percent": round((output_words / original_words - 1.0) * 100.0, 2),
        "within_budget": output_words <= original_words,
        "policy": "rewrite first, then compress; no quality rollback",
    }
    pass_evaluation = {
        "accepted": pass_accepted,
        "reason": "accepted_structurally_valid_output" if pass_accepted else rollback_reason,
        "rollback_policy": "none",
        "policy_description": "No detection/quality rollback. Structural and factual protections remain mandatory.",
        "warning": None,
    }

    if cycle:
        job["rewrite_cycle_count"] = cycle_number
        rewrite_pass_count = int(job.get("rewrite_pass_count") or 1) + 1
        job["rewrite_pass_count"] = rewrite_pass_count
        history = list(job.get("style_score_history") or [])
        if not history:
            history.append({
                "pass": 0, "cycle": 0, "label": "Initial text",
                "score": initial_score["ai_style_score"], "confidence": initial_score["confidence"],
                "word_count": initial_score["word_count"],
            })
        history.append({
            "pass": rewrite_pass_count, "cycle": cycle_number,
            "label": f"Cycle {cycle_number}", "score": output_score["ai_style_score"],
            "confidence": output_score["confidence"], "word_count": output_score["word_count"],
            "accepted": pass_accepted,
        })
    else:
        job["rewrite_cycle_count"] = 0
        job["rewrite_pass_count"] = 1
        rewrite_pass_count = 1
        history = [
            {"pass": 0, "cycle": 0, "label": "Initial text", "score": initial_score["ai_style_score"], "confidence": initial_score["confidence"], "word_count": initial_score["word_count"]},
            {"pass": 1, "cycle": 0, "label": "Rewrite 1", "score": output_score["ai_style_score"], "confidence": output_score["confidence"], "word_count": output_score["word_count"], "accepted": pass_accepted},
        ]
    job["style_score_history"] = history
    save_job(job_id, job)

    style_scores = {
        "initial": initial_score,
        "source": source_score,
        "attempted": attempted_score,
        "current": output_score,
        "delta_from_initial": round(output_score["ai_style_score"] - initial_score["ai_style_score"], 1),
        "delta_from_previous": round(output_score["ai_style_score"] - source_score["ai_style_score"], 1),
        "attempted_delta_from_previous": round(attempted_score["ai_style_score"] - source_score["ai_style_score"], 1),
        "history": history,
        "disclaimer": "Diagnostic only. V21 does not use this score to generate, select, accept or reject rewrites.",
    }

    log_payload = {
        "engine": "airem_document_studio_v21_linguistic",
        "rewrite_engine": engine_name,
        "ml_used": False,
        "style_profile": style_profile_name,
        "operation": "cycle" if cycle else "initial_rewrite",
        "cycle_number": cycle_number,
        "unlimited_rewrite_cycles": True,
        "quality_rollback": False,
        "source": "current_edited_text" if cycle else "original_extract",
        "profile": profile,
        "manual_profile": serialise_manual_profile(manual_profile) if manual_profile else None,
        "manual_settings_submitted": manual_settings if profile == "manual" else None,
        "pass_accepted": pass_accepted,
        "rollback_reason": rollback_reason,
        "attempted_texts": attempted_texts,
        "edited_texts": edited_texts,
        "chunk_logs": chunk_logs,
        "attempted_validation": attempted_validation,
        "validation": validation,
        "pass_evaluation": pass_evaluation,
        "word_budget": final_budget,
        "style_scores": style_scores,
        "protected_terms_submitted": protected_terms,
    }

    logs_dir = Path(job["logs_dir"])
    latest_log_path = logs_dir / "local_rewrite_log.json"
    save_json(log_payload, latest_log_path)
    cycle_log_url = None
    if cycle:
        cycle_dir = logs_dir / "rewrite_cycles"
        cycle_dir.mkdir(parents=True, exist_ok=True)
        cycle_log_path = cycle_dir / f"rewrite_cycle_{cycle_number:03d}.json"
        save_json(log_payload, cycle_log_path)
        cycle_log_url = url_for("download_file", job_id=job_id, filename=f"logs/rewrite_cycles/rewrite_cycle_{cycle_number:03d}.json")

    if validation["valid"]:
        save_json({"parsed_sections": parsed_sections}, logs_dir / "latest_valid_edited_sections.json")

    validation["can_reinsert"] = validation["valid"]
    rewrite_log_url = url_for("download_file", job_id=job_id, filename="logs/local_rewrite_log.json")
    validation["rewrite_log_url"] = rewrite_log_url
    return jsonify({
        "ok": validation["valid"],
        "pass_accepted": pass_accepted,
        "rollback_policy": "none",
        "rollback_reason": rollback_reason,
        "operation": "cycle" if cycle else "initial_rewrite",
        "cycle_number": cycle_number,
        "unlimited_rewrite_cycles": True,
        "engine": engine_name,
        "ml_used": False,
        "style_profile": style_profile_name,
        "profile": profile,
        "edited_texts": edited_texts,
        "attempted_texts": attempted_texts if not pass_accepted else None,
        "chunk_logs": chunk_logs,
        "validation": validation,
        "attempted_validation": attempted_validation,
        "pass_evaluation": pass_evaluation,
        "word_budget": final_budget,
        "rewrite_log_url": rewrite_log_url,
        "cycle_log_url": cycle_log_url,
        "style_scores": style_scores,
    })


@app.post("/reinsert/<job_id>")
def reinsert(job_id: str):
    job = get_job(job_id)
    mapping = load_map(job["map_path"])
    payload = request.get_json(silent=True) or {}
    edited_texts = normalise_edited_texts(payload)
    validation = validate_edited_chunks(mapping, edited_texts)
    if not validation["valid"]:
        validation.pop("parsed_sections", None)
        return jsonify({"ok": False, "message": "Validation failed. Fix the listed issues before reinserting.", "validation": validation}), 400

    final_path = Path(job["output_dir"]) / "4_org_fin.docx"
    log_path = Path(job["logs_dir"]) / "replacement_log.json"
    result = reinsert_sections(job["original_path"], mapping, validation["parsed_sections"], final_path, log_path)
    job["final_path"] = str(final_path)
    save_job(job_id, job)
    return jsonify({
        "ok": True,
        "message": f"Reinserted {result['replacement_count']} edited text items successfully.",
        "download_url": url_for("download_file", job_id=job_id, filename="4_org_fin/4_org_fin.docx"),
        "replacement_log_url": url_for("download_file", job_id=job_id, filename="logs/replacement_log.json"),
    })


if __name__ == "__main__":
    debug_mode = os.getenv("AIREM_DEBUG", "0").strip().lower() in {"1", "true", "yes"}
    host = os.getenv("AIREM_HOST", "127.0.0.1")
    port = int(os.getenv("AIREM_PORT", "5000"))
    app.run(debug=debug_mode, host=host, port=port)
