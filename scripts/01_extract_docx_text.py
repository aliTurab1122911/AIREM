from __future__ import annotations

import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pathlib import Path

from scripts.pipeline_engine import create_extraction_package


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract editable DOCX text into one or more |sec|-based DOCX chunks.")
    parser.add_argument("--input", required=True, help="Original DOCX path")
    parser.add_argument("--output-dir", required=True, help="Directory for extracted DOCX parts")
    parser.add_argument("--map", required=True, help="Extraction map JSON path")
    parser.add_argument("--max-words", type=int, default=4500, help="Maximum words per extract part. Recommended: 4000-5000.")
    args = parser.parse_args()

    payload = create_extraction_package(args.input, args.output_dir, args.map, max_words=args.max_words)
    print(f"Extracted {payload['section_count']} sections into {payload['chunk_count']} file(s).")
    for chunk in payload["chunks"]:
        print(f"- part {chunk['chunk_number']:02d}: {chunk['word_count']} words, {chunk['section_count']} sections -> {Path(args.output_dir) / chunk['extract_file']}")
    if payload.get("warnings"):
        print("Warnings:")
        for warning in payload["warnings"]:
            print(f"- Section {warning['section_number']}: {warning['word_count']} words; {warning['message']}")
    print(f"Saved map -> {args.map}")


if __name__ == "__main__":
    main()
