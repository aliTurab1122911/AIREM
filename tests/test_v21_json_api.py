from __future__ import annotations

import io
from pathlib import Path

import app as legacy
from processor_app import app


FIXTURE = Path(__file__).parents[1] / "docs" / "sample_1_org.docx"


def _upload(client):
    with FIXTURE.open("rb") as handle:
        response = client.post(
            "/internal/v1/documents",
            data={"docx_file": (io.BytesIO(handle.read()), "sample.docx"), "max_words": "4500"},
            content_type="multipart/form-data",
        )
    assert response.status_code == 201
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["job_id"]
    assert payload["inventory"]["blocks"]
    assert "html" not in payload
    return payload


def test_document_upload_extract_and_chunks_are_structured_json(tmp_path, monkeypatch):
    monkeypatch.setattr(legacy, "WORKSPACE", tmp_path / "workspace")
    legacy.WORKSPACE.mkdir()
    client = app.test_client()
    uploaded = _upload(client)
    job_id = uploaded["job_id"]

    extracted = client.post(
        f"/internal/v1/rewrite-jobs/{job_id}/extract",
        json={"selection_mode": "automatic"},
    )
    assert extracted.status_code == 200
    body = extracted.get_json()
    assert body["ok"] is True
    assert body["mapping"]["chunk_count"] == len(body["chunks"])
    assert body["chunks"]
    assert body["chunks"][0]["text"].strip()

    chunks = client.get(f"/internal/v1/rewrite-jobs/{job_id}/chunks")
    assert chunks.status_code == 200
    assert chunks.get_json()["chunks"] == body["chunks"]

    job = client.get(f"/internal/v1/documents/{job_id}")
    assert job.status_code == 200
    assert job.get_json()["job"]["has_extraction"] is True


def test_json_api_can_rewrite_validate_and_reinsert(tmp_path, monkeypatch):
    monkeypatch.setattr(legacy, "WORKSPACE", tmp_path / "workspace")
    legacy.WORKSPACE.mkdir()
    client = app.test_client()
    job_id = _upload(client)["job_id"]
    extracted = client.post(f"/internal/v1/rewrite-jobs/{job_id}/extract", json={"selection_mode": "automatic"}).get_json()

    rewritten = client.post(
        f"/internal/v1/rewrite-jobs/{job_id}/rewrite",
        json={"profile": "natural", "engine": "linguistic", "style_profile": "natural_student"},
    )
    assert rewritten.status_code == 200
    rewrite_body = rewritten.get_json()
    assert rewrite_body["ok"] is True
    assert rewrite_body["edited_texts"]

    validated = client.post(
        f"/internal/v1/rewrite-jobs/{job_id}/validate",
        json={"edited_texts": rewrite_body["edited_texts"]},
    )
    assert validated.status_code == 200
    assert validated.get_json()["validation"]["valid"] is True

    reinserted = client.post(
        f"/internal/v1/rewrite-jobs/{job_id}/reinsert",
        json={"edited_texts": rewrite_body["edited_texts"]},
    )
    assert reinserted.status_code == 200
    result = reinserted.get_json()
    assert result["ok"] is True
    assert result["replacement_count"] > 0
    assert result["download_url"].endswith("/4_org_fin/4_org_fin.docx")
    final_path = legacy.WORKSPACE / job_id / "4_org_fin" / "4_org_fin.docx"
    assert final_path.exists()


def test_formatting_analysis_and_apply_return_json(tmp_path, monkeypatch):
    monkeypatch.setattr(legacy, "WORKSPACE", tmp_path / "workspace")
    legacy.WORKSPACE.mkdir()
    client = app.test_client()
    with FIXTURE.open("rb") as handle:
        analysed = client.post(
            "/internal/v1/formatting",
            data={"docx_file": (io.BytesIO(handle.read()), "format-me.docx")},
            content_type="multipart/form-data",
        )
    assert analysed.status_code == 201
    body = analysed.get_json()
    assert body["ok"] is True
    assert body["analysis"]["paragraph_count"] > 0
    assert body["preview"]["blocks"]

    applied = client.post(
        f"/internal/v1/formatting/{body['job_id']}/apply",
        json={"settings": {"body_font": "Arial", "body_size": 11, "page_numbers": True}},
    )
    assert applied.status_code == 200
    result = applied.get_json()
    assert result["ok"] is True
    assert result["download_url"].endswith("_formatted.docx")


def test_text_and_detection_compatibility_endpoints_are_json(tmp_path, monkeypatch):
    monkeypatch.setattr(legacy, "WORKSPACE", tmp_path / "workspace")
    legacy.WORKSPACE.mkdir()
    client = app.test_client()
    rewrite = client.post(
        "/internal/v1/text/rewrite",
        json={"text": "It is important to note that the system is capable of providing an explanation.", "profile": "rewrite_compress"},
    )
    assert rewrite.status_code == 200
    assert rewrite.is_json
    assert rewrite.get_json()["ok"] is True

    detection = client.post("/internal/v1/detection/text", json={"text": "A short diagnostic sample for the compatibility API."})
    assert detection.status_code == 200
    assert detection.is_json
    assert detection.get_json()["report"]
