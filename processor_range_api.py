from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Dict

from flask import Blueprint, jsonify, request, url_for

import app as legacy
from scripts.docx_pipeline_common import load_map, save_json, sections_to_text
from scripts.document_selector import sections_from_visual_ranges
from scripts.openai_edit_service import (
    MAX_EDIT_ITEMS_PER_BATCH,
    build_edit_items,
    edit_ranges_with_openai,
    manual_edit_drafts,
    openai_configuration,
)
from scripts.pipeline_engine import create_extraction_package_from_sections, reinsert_sections


range_api_bp = Blueprint("processor_range_api_v1", __name__, url_prefix="/internal/v1/range-edit")


def _error(message: str, status: int = 400, code: str = "RANGE_EDIT_VALIDATION_ERROR"):
    return jsonify({"ok": False, "error": {"code": code, "message": message}}), status


def _job(job_id: str):
    try:
        return legacy.get_job(job_id), None
    except FileNotFoundError:
        return None, _error("Job not found.", 404, "JOB_NOT_FOUND")


def _session_path(job: Dict[str, Any], session_id: str) -> Path:
    clean = "".join(ch for ch in str(session_id) if ch.isalnum() or ch in {"-", "_"})
    if not clean or clean != str(session_id):
        raise ValueError("Invalid edit session identifier.")
    root = Path(job["logs_dir"]) / "range_edit_sessions"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{clean}.json"


def _load_session(job: Dict[str, Any], session_id: str) -> Dict[str, Any]:
    path = _session_path(job, session_id)
    if not path.exists():
        raise FileNotFoundError("The range edit session was not found. Generate or prepare drafts again.")
    return load_map(path)


def _replacement_texts(session: Dict[str, Any], payload: Dict[str, Any]) -> list[str]:
    raw = payload.get("edits")
    if not isinstance(raw, list):
        raise ValueError("Reviewed edits are required.")
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


@range_api_bp.get("/configuration")
def range_edit_configuration_json():
    return jsonify({
        "ok": True,
        "configuration": openai_configuration(),
        "batch_item_limit": MAX_EDIT_ITEMS_PER_BATCH,
    })


@range_api_bp.post("/<job_id>/draft")
def range_edit_draft_json(job_id: str):
    job, error = _job(job_id)
    if error:
        return error
    inventory = load_map(job["inventory_path"])
    payload = request.get_json(silent=True) or {}
    visual_ranges = payload.get("visual_ranges")
    if not isinstance(visual_ranges, list) or not visual_ranges:
        return _error("Saved visual ranges are required.")
    try:
        sections = sections_from_visual_ranges(job["original_path"], inventory, visual_ranges)
        items = build_edit_items(sections, inventory)
        manual_only = bool(payload.get("manual_only"))
        prompt = str(payload.get("prompt") or "").strip()
        model = str(payload.get("model") or "").strip() or None
        result = manual_edit_drafts(items) if manual_only else edit_ranges_with_openai(items, prompt, model)
    except (ValueError, RuntimeError) as exc:
        return _error(str(exc))

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
        "batch_item_limit": result.get("batch_item_limit") or MAX_EDIT_ITEMS_PER_BATCH,
        "batch_summaries": result.get("batch_summaries", []),
        "visual_ranges": visual_ranges,
        "sections": sections,
        "edits": result["edits"],
    }
    save_json(session, _session_path(job, session_id))
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


@range_api_bp.post("/<job_id>/export")
def range_edit_export_json(job_id: str):
    job, error = _job(job_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    try:
        session = _load_session(job, str(payload.get("session_id") or ""))
        replacements = _replacement_texts(session, payload)
    except (ValueError, FileNotFoundError) as exc:
        return _error(str(exc))

    stem = Path(job["original_filename"]).stem
    tag = str(session["session_id"])[:8]
    output_name = f"{stem}_approved_range_edits_{tag}.docx"
    output_path = Path(job["output_dir"]) / output_name
    log_name = f"direct_range_edit_reinsertion_{tag}.json"
    log_path = Path(job["logs_dir"]) / log_name
    try:
        result = reinsert_sections(
            job["original_path"],
            {"sections": session.get("sections", [])},
            [[text] for text in replacements],
            output_path,
            log_path,
        )
    except Exception as exc:
        return _error(f"Direct reinsertion failed: {exc}")
    return jsonify({
        "ok": True,
        "job_id": job_id,
        "replacement_count": result["replacement_count"],
        "download_url": url_for("download_file", job_id=job_id, filename=f"4_org_fin/{output_name}"),
        "log_url": url_for("download_file", job_id=job_id, filename=f"logs/{log_name}"),
    })


@range_api_bp.post("/<job_id>/continue")
def range_edit_continue_json(job_id: str):
    job, error = _job(job_id)
    if error:
        return error
    if Path(job["map_path"]).exists():
        return _error(
            "This document already has an immutable extraction. Upload a new DOCX to continue a different range-edit selection.",
            409,
            "EXTRACTION_ALREADY_CREATED",
        )
    payload = request.get_json(silent=True) or {}
    try:
        session = _load_session(job, str(payload.get("session_id") or ""))
        replacements = _replacement_texts(session, payload)
    except (ValueError, FileNotFoundError) as exc:
        return _error(str(exc))

    sections = list(session.get("sections") or [])
    if not sections:
        return _error("The range edit session does not contain reinsertable sections.")
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
    edited_texts: Dict[str, str] = {}
    for chunk in mapping["chunks"]:
        lines = [[replacements[index]] for index in chunk["section_indices"]]
        approved_text = sections_to_text(lines)
        key = str(int(chunk["chunk_number"]))
        edited_texts[key] = approved_text
        # The continued extraction deliberately starts from the reviewed text.
        # Reinsertion coordinates remain the immutable original range sections.
        chunk["text"] = approved_text
        chunk["word_count"] = len(approved_text.split())
    save_json(mapping, job["map_path"])

    prefill_path = Path(job["logs_dir"]) / "prefill_approved_range_edits.json"
    save_json({"edited_texts": edited_texts}, prefill_path)
    job["prefill_edited_texts_path"] = str(prefill_path)
    job["selected_block_count"] = len(sections)
    job["selection_mode"] = "approved_range_edits"
    job["visual_range_count"] = len(session.get("visual_ranges", []))
    legacy.save_job(job_id, job)
    return jsonify({
        "ok": True,
        "job_id": job_id,
        "selection_mode": "approved_range_edits",
        "mapping": mapping,
        "chunks": mapping["chunks"],
        "edited_texts": edited_texts,
    })
