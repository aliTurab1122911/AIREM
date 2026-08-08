"""Production composition wrapper for the AIREM v21 Flask processor.

The legacy Jinja application remains intact. Production additionally registers a
resource-oriented JSON compatibility API so React/gateway callers do not need to
interpret rendered HTML responses.
"""

from app import app
from processor_api import api_bp


app.register_blueprint(api_bp)


@app.get("/healthz")
def healthz():
    """Report that the Python processor imported and is serving requests."""
    return {"ok": True, "service": "airem-processor", "engine": "v21", "json_api": "internal/v1"}
