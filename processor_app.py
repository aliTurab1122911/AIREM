"""Production composition wrapper for the unchanged AIREM v21 Flask processor.

PR 1 deliberately keeps app.py and the Python domain modules unchanged.  Gunicorn
imports this module so production health/readiness can be checked without using a
Jinja page as a health endpoint.
"""

from app import app


@app.get("/healthz")
def healthz():
    """Report that the Python processor imported and is serving requests."""
    return {"ok": True, "service": "airem-processor", "engine": "v21"}
