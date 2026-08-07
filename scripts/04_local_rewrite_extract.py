from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.docx_pipeline_common import load_map, save_json, write_extract_docx
from scripts.local_rewriter import build_manual_profile, rewrite_chunk_with_mapping, serialise_manual_profile


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply AIREM's local quality rewrite to extracted chunks.")
    parser.add_argument("--map", required=True, help="Path to extraction_map.json")
    parser.add_argument("--output-dir", required=True, help="Directory for rewritten extract DOCX files")
    parser.add_argument("--profile", choices=["conservative", "balanced", "plain", "expanded", "manual"], default="balanced")
    parser.add_argument("--manual-settings", default="", help="JSON file containing manual-profile control values")
    parser.add_argument("--log", default="", help="Optional JSON audit log path")
    args = parser.parse_args()

    mapping = load_map(args.map)
    manual_profile = None
    manual_settings = {}
    if args.profile == "manual":
        if args.manual_settings:
            manual_settings = json.loads(Path(args.manual_settings).read_text(encoding="utf-8"))
        manual_profile = build_manual_profile(manual_settings)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    logs = []

    for chunk in mapping["chunks"]:
        result = rewrite_chunk_with_mapping(
            mapping,
            chunk,
            profile_name=args.profile,
            profile_override=manual_profile,
        )
        output_path = output_dir / f"3_extract_airem_part_{int(chunk['chunk_number']):02d}.docx"
        write_extract_docx(result["sections"], output_path)
        logs.append({
            "chunk_number": int(chunk["chunk_number"]),
            "output_file": str(output_path),
            "summary": result["summary"],
            "lines": result["logs"],
        })

    if args.log:
        save_json({
            "profile": args.profile,
            "manual_profile": serialise_manual_profile(manual_profile) if manual_profile else None,
            "manual_settings_submitted": manual_settings if manual_profile else None,
            "chunks": logs,
        }, args.log)


if __name__ == "__main__":
    main()
