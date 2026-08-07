from __future__ import annotations

import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pathlib import Path

from scripts.docx_pipeline_common import load_map, read_extract_sections, save_json, sections_to_text
from scripts.pipeline_engine import validate_edited_chunks


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate one or more edited extract DOCX files against extraction map.")
    parser.add_argument("--edited-dir", required=True, help="Directory containing edited extract DOCX parts")
    parser.add_argument("--map", required=True, help="Extraction map JSON path")
    parser.add_argument("--report", required=True, help="Validation report JSON path")
    args = parser.parse_args()

    mapping = load_map(args.map)
    edited_texts = {}
    edited_dir = Path(args.edited_dir)
    for chunk in mapping["chunks"]:
        n = int(chunk["chunk_number"])
        candidates = [
            edited_dir / f"3_extract_airem_part_{n:02d}.docx",
            edited_dir / f"3_extract_airem_part_{n:02d}_paste_here.docx",
            edited_dir / f"part_{n:02d}.docx",
        ]
        found = next((p for p in candidates if p.exists()), None)
        if not found:
            edited_texts[n] = ""
            continue
        sections = read_extract_sections(found)
        edited_texts[n] = sections_to_text(sections)

    report = validate_edited_chunks(mapping, edited_texts)
    report.pop("parsed_sections", None)
    save_json(report, args.report)
    if report["valid"]:
        print("Validation passed. Edited extract parts are ready for reinsertion.")
    else:
        print(f"Validation failed with {report['issue_count']} issue(s). See {args.report}")


if __name__ == "__main__":
    main()
