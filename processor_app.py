"""Production composition wrapper for the AIREM v21 Python domain processor.

The protected v21 application/services remain authoritative for processing
semantics. Production browser traffic does not expose the historical Jinja route
tree: the Fastify gateway calls the structured /internal/v1 blueprints registered
here, while artifact streaming remains an internal processor capability.
"""

from pathlib import Path

from flask import jsonify, request

from app import app, get_job, list_profiles
from processor_api import api_bp
from processor_range_api import range_api_bp

app.register_blueprint(api_bp)
app.register_blueprint(range_api_bp)


@app.before_request
def protect_immutable_json_extraction():
    """Do not let an API client overwrite the fixed v21 extraction map."""
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


@app.get("/internal/v1/rewrite/profiles")
def rewrite_profiles_json():
    """Expose the protected processor's profile registry through the JSON API."""
    return jsonify({"profiles": list_profiles()})


@app.get("/healthz")
def healthz():
    """Report that the internal v21 processor API imported and is serving."""
    return {"ok": True, "service": "airem-processor", "engine": "v21", "json_api": "internal/v1"}
