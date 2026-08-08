from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Dict

from flask import Blueprint, jsonify, request, url_for
from werkzeug.utils import secure_filename

import app as legacy
from scripts.docx_pipeline_common import load_map, save_json
from scripts.document_selector import (
    analyse_document_blocks,
    resolve_selected_ids,
    sections_from_selected_blocks,
    sections_from_visual_ranges,
)
from scripts.pipeline_engine import (
    create_extraction_package_from_sections,
    reinsert_sections,
    validate_edited_chunks,
)
from scripts.detection_service import detect_docx, detect_text
from scripts.formatting_service import analyse_document_formatting, apply_document_formatting
from scripts.text_rewriter_service import rewrite_pasted_text
from scripts.turnitin_mapper import analyse_turnitin_report


api_bp = Blueprint("processor_api_v1", __name__, url_prefix="/internal/v1")


def _error(message: str, status: int = 400, code: str = "PROCESSOR_VALIDATION_ERROR"):
    return jsonify({"ok": False, "error": {"code": code, "message": message}}), status


def _job_or_error(job_id: str):
    try:
        return legacy.get_job(job_id), None
    except FileNotFoundError:
        return None, _error("Job not found.", 404, "JOB_NOT_FOUND")


def _download(job_id: str, relative: str) -> str:
    return url_for("download_file", job_id=job_id, filename=relative)


def _preview(job_id: str, relative: str) -> str:
    return url_for("preview_file", job_id=job_id, filename=relative)


def _public_job(job: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "job_id": job["job_id"],
        "job_type": job.get("job_type"),
        "original_filename": job.get("original_filename"),
        "max_words": job.get("max_words"),
        "selection_mode": job.get("selection_mode"),
        "selected_block_count": job.get("selected_block_count", 0),
        "visual_range_count": job.get("visual_range_count", 0),
        "rewrite_cycle_count": job.get("rewrite_cycle_count", 0),
        "rewrite_pass_count": job.get("rewrite_pass_count", 0),
        "has_extraction": Path(str(job.get("map_path") or "")).exists(),
        "has_final_document": bool(job.get("final_path")) and Path(str(job.get("final_path"))).exists(),
    }
    if payload["has_final_document"]:
        payload["download_url"] = _download(job["job_id"], "4_org_fin/4_org_fin.docx")
    return payload


@api_bp.post("/documents")
def upload_document_json():
    uploaded = request.files.get("docx_file")
    if not uploaded or not uploaded.filename:
        return _error("Upload a .docx file first.")
    if not uploaded.filename.lower().endswith(".docx"):
        return _error("Only .docx files are supported.", 415, "UNSUPPORTED_FILE_TYPE")

    try:
        max_words = int(request.form.get("max_words") or 4500)
    except ValueError:
        max_words = 4500
    max_words = max(500, min(max_words, 5000))

    job_id = str(uuid.uuid4())
    root = legacy.job_dir(job_id)
    input_dir = root / "1_org"
    extract_dir = root / "2_extract"
    output_dir = root / "4_org_fin"
    logs_dir = root / "logs"
    for folder in (input_dir, extract_dir, output_dir, logs_dir):
        folder.mkdir(parents=True, exist_ok=True)

    safe_name = secure_filename(uploaded.filename) or "input.docx"
    original_path = input_dir / safe_name
    uploaded.save(original_path)
    try:
        inventory = analyse_document_blocks(original_path)
    except Exception as exc:
        return _error(f"The DOCX could not be analysed: {exc}")

    inventory_path = logs_dir / "document_inventory.json"
    map_path = logs_dir / "extraction_map.json"
    save_json(inventory, inventory_path)
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
    legacy.save_job(job_id, job)
    return jsonify({"ok": True, "job_id": job_id, "job": _public_job(job), "inventory": inventory}), 201


@api_bp.get("/documents/<job_id>")
def document_job_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    inventory = load_map(job["inventory_path"]) if Path(job["inventory_path"]).exists() else None
    mapping = load_map(job["map_path"]) if Path(job["map_path"]).exists() else None
    return jsonify({"ok": True, "job": _public_job(job), "inventory": inventory, "mapping": mapping})


@api_bp.post("/rewrite-jobs/<job_id>/extract")
def extract_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    inventory = load_map(job["inventory_path"])
    payload = request.get_json(silent=True) or {}
    mode = str(payload.get("selection_mode") or "automatic")
    include_headings = bool(payload.get("include_headings"))
    include_captions = bool(payload.get("include_captions"))
    include_table_headers = bool(payload.get("include_table_headers"))
    visual_ranges = payload.get("visual_ranges") if isinstance(payload.get("visual_ranges"), list) else []

    try:
        if mode == "visual":
            selected_ids = []
            sections = sections_from_visual_ranges(job["original_path"], inventory, visual_ranges)
        else:
            selected_ids = resolve_selected_ids(
                inventory,
                mode=mode,
                manual_ids=payload.get("selected_blocks") if isinstance(payload.get("selected_blocks"), list) else [],
                start_order=payload.get("start_order"),
                end_order=payload.get("end_order"),
                include_headings=include_headings,
                include_captions=include_captions,
            )
            if not selected_ids:
                return _error("No editable content was selected.")
            sections = sections_from_selected_blocks(
                job["original_path"], selected_ids, include_table_headers=include_table_headers
            )
    except (TypeError, ValueError) as exc:
        return _error(str(exc))

    if not sections:
        return _error("The selected content did not contain reinsertable text.")

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
            "start_order": payload.get("start_order"),
            "end_order": payload.get("end_order"),
        },
    )
    job["selected_block_count"] = len(selected_ids) if mode != "visual" else len(visual_ranges)
    job["selection_mode"] = mode
    job["visual_range_count"] = len(visual_ranges)
    legacy.save_job(job_id, job)
    return jsonify({"ok": True, "job_id": job_id, "mapping": mapping, "chunks": mapping["chunks"]})


@api_bp.get("/rewrite-jobs/<job_id>/chunks")
def chunks_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    map_path = Path(job["map_path"])
    if not map_path.exists():
        return _error("Extraction has not been created for this job.", 409, "EXTRACTION_REQUIRED")
    mapping = load_map(map_path)
    return jsonify({"ok": True, "job_id": job_id, "chunks": mapping["chunks"], "mapping": mapping})


@api_bp.post("/rewrite-jobs/<job_id>/rewrite")
def rewrite_json(job_id: str):
    return legacy._run_rewrite(job_id, request.get_json(silent=True) or {}, cycle=False)


@api_bp.post("/rewrite-jobs/<job_id>/cycles")
def rewrite_cycle_json(job_id: str):
    return legacy._run_rewrite(job_id, request.get_json(silent=True) or {}, cycle=True)


@api_bp.post("/rewrite-jobs/<job_id>/validate")
def validate_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    mapping = load_map(job["map_path"])
    edited_texts = legacy.normalise_edited_texts(request.get_json(silent=True) or {})
    report = validate_edited_chunks(mapping, edited_texts)
    parsed_sections = report.pop("parsed_sections", [])
    report["can_reinsert"] = report["valid"]
    report["validation_report_url"] = _download(job_id, "logs/validation_report.json")
    save_json(report, Path(job["logs_dir"]) / "validation_report.json")
    if report["valid"]:
        save_json({"parsed_sections": parsed_sections}, Path(job["logs_dir"]) / "latest_valid_edited_sections.json")
    return jsonify({"ok": report["valid"], "validation": report})


@api_bp.post("/rewrite-jobs/<job_id>/reinsert")
def reinsert_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    mapping = load_map(job["map_path"])
    edited_texts = legacy.normalise_edited_texts(request.get_json(silent=True) or {})
    validation = validate_edited_chunks(mapping, edited_texts)
    if not validation["valid"]:
        validation.pop("parsed_sections", None)
        return jsonify({"ok": False, "error": {"code": "VALIDATION_FAILED", "message": "Validation failed before reinsertion."}, "validation": validation}), 400
    final_path = Path(job["output_dir"]) / "4_org_fin.docx"
    log_path = Path(job["logs_dir"]) / "replacement_log.json"
    result = reinsert_sections(job["original_path"], mapping, validation["parsed_sections"], final_path, log_path)
    job["final_path"] = str(final_path)
    legacy.save_job(job_id, job)
    return jsonify({
        "ok": True,
        "job_id": job_id,
        "replacement_count": result["replacement_count"],
        "download_url": _download(job_id, "4_org_fin/4_org_fin.docx"),
        "replacement_log_url": _download(job_id, "logs/replacement_log.json"),
    })


@api_bp.post("/detection/text")
def detection_text_json():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "")
    if not text.strip():
        return _error("Paste text before running detection.")
    return jsonify({"ok": True, "report": detect_text(text, table_mode=False, include_passages=True)})


@api_bp.post("/detection/file")
def detection_file_json():
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return _error("Choose a DOCX or TXT file first.")
    suffix = Path(uploaded.filename).suffix.lower()
    if suffix not in {".docx", ".txt"}:
        return _error("Only .docx and .txt files are supported.", 415, "UNSUPPORTED_FILE_TYPE")
    temp_dir = legacy.WORKSPACE / "detector_uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = temp_dir / f"{uuid.uuid4()}{suffix}"
    uploaded.save(temp_path)
    try:
        report = detect_docx(temp_path) if suffix == ".docx" else detect_text(temp_path.read_text(encoding="utf-8", errors="replace"), include_passages=True)
        return jsonify({"ok": True, "filename": uploaded.filename, "report": report})
    finally:
        temp_path.unlink(missing_ok=True)


@api_bp.post("/text/rewrite")
def text_rewrite_json():
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
        return _error(str(exc))
    return jsonify(result)


@api_bp.post("/turnitin/<job_id>")
def turnitin_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    inventory = load_map(job["inventory_path"])
    uploaded = request.files.get("turnitin_pdf")
    if not uploaded or not uploaded.filename:
        return _error("Choose the Turnitin AI-writing PDF first.")
    if not uploaded.filename.lower().endswith(".pdf"):
        return _error("Only Turnitin PDF reports are supported.", 415, "UNSUPPORTED_FILE_TYPE")

    report_dir = legacy.job_dir(job_id) / "turnitin"
    report_dir.mkdir(parents=True, exist_ok=True)
    safe_name = secure_filename(uploaded.filename) or "turnitin_report.pdf"
    pdf_path = report_dir / safe_name
    uploaded.save(pdf_path)
    try:
        with pdf_path.open("rb") as handle:
            if handle.read(5) != b"%PDF-":
                raise ValueError("The uploaded file is not a valid PDF.")
        analysis = analyse_turnitin_report(job["original_path"], job["original_filename"], inventory, pdf_path)
    except Exception as exc:
        pdf_path.unlink(missing_ok=True)
        return _error(f"The Turnitin report could not be analysed: {exc}")

    analysis["uploaded_report_filename"] = safe_name
    analysis_path = Path(job["logs_dir"]) / "turnitin_mapping.json"
    save_json(analysis, analysis_path)
    relative = str(pdf_path.relative_to(legacy.job_dir(job_id))).replace("\\", "/")
    job["turnitin_analysis_path"] = str(analysis_path)
    job["turnitin_pdf_relative"] = relative
    legacy.save_job(job_id, job)
    return jsonify({
        "ok": True,
        "job_id": job_id,
        "analysis": analysis,
        "pdf_preview_url": _preview(job_id, relative),
        "pdf_download_url": _download(job_id, relative),
    })


@api_bp.post("/formatting")
def formatting_analyse_json():
    uploaded = request.files.get("docx_file")
    if not uploaded or not uploaded.filename:
        return _error("Upload a .docx file first.")
    if not uploaded.filename.lower().endswith(".docx"):
        return _error("Only .docx files are supported.", 415, "UNSUPPORTED_FILE_TYPE")

    job_id = str(uuid.uuid4())
    root = legacy.job_dir(job_id)
    input_dir, output_dir, logs_dir = root / "1_org", root / "formatted", root / "logs"
    for folder in (input_dir, output_dir, logs_dir):
        folder.mkdir(parents=True, exist_ok=True)
    safe_name = secure_filename(uploaded.filename) or "input.docx"
    original_path = input_dir / safe_name
    uploaded.save(original_path)
    try:
        report = analyse_document_formatting(original_path)
        preview = analyse_document_blocks(original_path)
    except Exception as exc:
        return _error(f"The DOCX could not be analysed: {exc}")
    report_path, preview_path = logs_dir / "formatting_analysis.json", logs_dir / "formatting_preview.json"
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
    legacy.save_job(job_id, job)
    return jsonify({"ok": True, "job_id": job_id, "analysis": report, "preview": preview}), 201


@api_bp.post("/formatting/<job_id>/apply")
def formatting_apply_json(job_id: str):
    job, error = _job_or_error(job_id)
    if error:
        return error
    if job.get("job_type") != "formatting":
        return _error("This job is not a formatting job.", 409, "WRONG_JOB_TYPE")
    payload = request.get_json(silent=True) or {}
    options = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
    output_name = f"{Path(job['original_filename']).stem}_formatted.docx"
    output_path = Path(job["output_dir"]) / output_name
    try:
        result = apply_document_formatting(job["original_path"], output_path, options)
    except Exception as exc:
        return _error(f"Formatting failed: {exc}")
    result_path = Path(job["logs_dir"]) / "formatting_result.json"
    save_json(result, result_path)
    return jsonify({
        "ok": True,
        "job_id": job_id,
        "result": result,
        "download_url": _download(job_id, f"formatted/{output_name}"),
        "report_url": _download(job_id, "logs/formatting_result.json"),
    })
