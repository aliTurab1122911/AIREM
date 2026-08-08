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
    return response.get_json()


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(legacy, "WORKSPACE", tmp_path / "workspace")
    legacy.WORKSPACE.mkdir()
    return app.test_client()


def test_inventory_visual_ids_are_stable_for_same_docx(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    first = _upload(client)["inventory"]
    second = _upload(client)["inventory"]
    first_ids = [(item["visual_id"], item["order"], item["text"]) for item in first["visual_elements"]]
    second_ids = [(item["visual_id"], item["order"], item["text"]) for item in second["visual_elements"]]
    assert first_ids == second_ids
    assert any(item["visual_id"].startswith("vp_") for item in first["visual_elements"])
    assert any(item["visual_id"].startswith("vc_") for item in first["visual_elements"])


def test_first_extraction_is_immutable(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    uploaded = _upload(client)
    job_id = uploaded["job_id"]
    first = client.post(f"/internal/v1/rewrite-jobs/{job_id}/extract", json={"selection_mode": "automatic"})
    assert first.status_code == 200
    second = client.post(f"/internal/v1/rewrite-jobs/{job_id}/extract", json={"selection_mode": "range", "start_order": 0, "end_order": 2})
    assert second.status_code == 409
    assert second.get_json()["error"]["code"] == "EXTRACTION_ALREADY_CREATED"


def test_manual_range_and_visual_selection_use_inventory_coordinates(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    manual_upload = _upload(client)
    manual_block = next(block for block in manual_upload["inventory"]["blocks"] if block["default_selected"])
    manual = client.post(
        f"/internal/v1/rewrite-jobs/{manual_upload['job_id']}/extract",
        json={"selection_mode": "manual", "selected_blocks": [manual_block["block_id"]]},
    )
    assert manual.status_code == 200
    manual_mapping = manual.get_json()["mapping"]
    assert manual_block["block_id"] in manual_mapping["selection"]["selected_block_ids"]

    range_upload = _upload(client)
    range_block = next(block for block in range_upload["inventory"]["blocks"] if block["default_selected"])
    ranged = client.post(
        f"/internal/v1/rewrite-jobs/{range_upload['job_id']}/extract",
        json={"selection_mode": "range", "start_order": range_block["order"], "end_order": range_block["order"]},
    )
    assert ranged.status_code == 200
    assert range_block["block_id"] in ranged.get_json()["mapping"]["selection"]["selected_block_ids"]

    visual_upload = _upload(client)
    element = next(item for item in visual_upload["inventory"]["visual_elements"] if len(item["text"].strip()) >= 12)
    text = element["text"]
    start = next(index for index, char in enumerate(text) if not char.isspace())
    end = min(len(text), start + 12)
    fragment = text[start:end]
    visual = client.post(
        f"/internal/v1/rewrite-jobs/{visual_upload['job_id']}/extract",
        json={
            "selection_mode": "visual",
            "visual_ranges": [{
                "start_id": element["visual_id"], "start_offset": start,
                "end_id": element["visual_id"], "end_offset": end,
                "source": "manual", "preview": fragment,
            }],
        },
    )
    assert visual.status_code == 200
    body = visual.get_json()
    assert body["mapping"]["selection"]["visual_ranges"][0]["start_id"] == element["visual_id"]
    items = [item for section in body["mapping"]["sections"] for item in section["items"]]
    assert any(item.get("visual_id") == element["visual_id"] and item.get("start_offset") == start and item.get("end_offset") == end and item.get("original_text") == fragment for item in items)
