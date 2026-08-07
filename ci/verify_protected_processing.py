#!/usr/bin/env python3
"""Fail when immutable legacy processing sources differ from the reviewed manifest."""
from hashlib import sha256
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
manifest = ROOT / "ci" / "protected-processing.sha256"
errors: list[str] = []
listed: set[str] = set()
for line in manifest.read_text(encoding="utf-8").splitlines():
    expected, relative = line.split("  ", 1)
    listed.add(relative)
    path = ROOT / relative
    if not path.is_file():
        errors.append(f"missing protected file: {relative}")
        continue
    actual = sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        errors.append(f"protected file changed: {relative} (expected {expected}, got {actual})")
protected = {"app.py"} | {
    path.relative_to(ROOT).as_posix()
    for path in (ROOT / "scripts").rglob("*")
    if path.is_file() and "__pycache__" not in path.parts
}
for relative in sorted(protected - listed):
    errors.append(f"unreviewed file added to protected set: {relative}")
for relative in sorted(listed - protected):
    errors.append(f"manifest contains a file outside the protected set: {relative}")
if errors:
    print("\n".join(errors), file=sys.stderr)
    print("Processing changes require an explicit review and manifest update.", file=sys.stderr)
    raise SystemExit(1)
print("Protected Python processing sources match the reviewed manifest.")
