from __future__ import annotations

import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pathlib import Path

from scripts.docx_pipeline_common import load_map, read_extract_sections, sections_to_text
from scripts.pipeline_engine import reinsert_sections, validate_edited_chunks


def main() -> None:
    parser = argparse.ArgumentParser(description="Reinsert edited extract parts into the original DOCX.")
    parser.add_argument("--original", required=True, help="Original DOCX path")
    parser.add_argument("--edited-dir", required=True, help="Directory containing edited extract DOCX parts")
    parser.add_argument("--map", required=True, help="Extraction map JSON path")
    parser.add_argument("--output", required=True, help="Final DOCX output path")
    parser.add_argument("--log", required=True, help="Replacement log JSON path")
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
            raise SystemExit(f"Missing edited DOCX for part {n:02d}. Expected one of: {', '.join(str(c) for c in candidates)}")
        edited_texts[n] = sections_to_text(read_extract_sections(found))

    validation = validate_edited_chunks(mapping, edited_texts)
    if not validation["valid"]:
        raise SystemExit(f"Validation failed with {validation['issue_count']} issue(s). Run validation first.")

    result = reinsert_sections(args.original, mapping, validation["parsed_sections"], args.output, args.log)
    print(f"Inserted {result['replacement_count']} edited text items -> {args.output}")
    print(f"Saved replacement log -> {args.log}")


if __name__ == "__main__":
    main()
