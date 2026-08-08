"""Production composition wrapper for the AIREM v21 Flask processor.

The legacy Jinja application remains intact. Production additionally registers a
resource-oriented JSON compatibility API so React/gateway callers do not need to
interpret rendered HTML responses.
"""

from pathlib import Path

from flask import jsonify, request

from app import app, get_job
from processor_api import api_bp


app.register_blueprint(api_bp)


@app.before_request
def protect_immutable_json_extraction():
    """Do not let an API client overwrite the fixed v21 extraction map.

    A document job receives exactly one JSON extraction. A different selection
    requires a new upload/job, keeping every later rewrite/cycle/reinsertion tied
    to one immutable source mapping.
    """
    if request.method != "POST":
        return None
    parts = request.path.strip("/").split("/")
    if len(parts) != 5 or parts[:3] != ["internal", "v1", "rewrite-jobs"] or parts[4] != "extract":
        return None
    job_id = parts[3]
    try:
        job = get_job(job_id)
    except FileNotFoundError:
        return None
    map_path = Path(str(job.get("map_path") or ""))
    if not map_path.exists():
        return None
    return jsonify({
        "ok": False,
        "error": {
            "code": "EXTRACTION_ALREADY_CREATED",
            "message": "This document already has an immutable extraction. Upload a new DOCX to create a different selection.",
        },
    }), 409


@app.get("/healthz")
def healthz():
    """Report that the Python processor imported and is serving requests."""
    return {"ok": True, "service": "airem-processor", "engine": "v21", "json_api": "internal/v1"}
