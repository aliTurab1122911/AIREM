#!/bin/bash
set -euo pipefail

IMAGE="airem-processor:pr1-smoke"
PORT="${PROCESSOR_SMOKE_PORT:-5001}"
BASE="http://127.0.0.1:${PORT}"
TMP="$(mktemp -d)"
CONTAINER=""

cleanup() {
  status=$?
  if [[ -n "$CONTAINER" ]]; then
    if [[ $status -ne 0 ]]; then
      echo "--- processor logs ---" >&2
      docker logs "$CONTAINER" >&2 || true
    fi
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT

echo "[processor-smoke] building production processor image"
docker build -t "$IMAGE" -f Dockerfile.python .

CONTAINER="$(docker run -d -p "127.0.0.1:${PORT}:5000" -e PROCESSOR_WORKERS=1 "$IMAGE")"

for _ in $(seq 1 40); do
  if curl --fail --silent "$BASE/healthz" >"$TMP/health.json"; then
    break
  fi
  sleep 1
done

python - "$TMP/health.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload == {"engine": "v21", "ok": True, "service": "airem-processor"}, payload
PY

echo "[processor-smoke] text rewrite"
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data '{"text":"It is important to note that the proposed system is capable of providing an explanation of the decision.","profile":"natural","engine":"linguistic","style_profile":"natural_student"}' \
  "$BASE/api/text/rewrite" >"$TMP/text-rewrite.json"
python - "$TMP/text-rewrite.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"] is True, payload
assert payload["engine"] == "linguistic", payload
assert payload["ml_used"] is False, payload
assert payload["rewritten_text"].strip(), payload
PY

echo "[processor-smoke] text detection"
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data '{"text":"This is a direct processor smoke test for the diagnostic endpoint."}' \
  "$BASE/api/detect-text" >"$TMP/detection.json"
python - "$TMP/detection.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"] is True, payload
assert isinstance(payload["report"], dict), payload
PY

echo "[processor-smoke] DOCX upload and inventory"
curl --fail --silent --show-error \
  -F 'docx_file=@docs/sample_1_org.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  -F 'max_words=4500' \
  "$BASE/upload" >"$TMP/upload.html"
JOB_ID="$(python - "$TMP/upload.html" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'/create-extract/([0-9a-f-]{36})', html)
assert match, "upload response did not expose a rewrite job"
print(match.group(1))
PY
)"

echo "[processor-smoke] DOCX extraction"
curl --fail --silent --show-error \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'selection_mode=automatic' \
  "$BASE/create-extract/$JOB_ID" >"$TMP/workspace.html"
grep -q 'rewrite' "$TMP/workspace.html"

echo "[processor-smoke] DOCX rewrite"
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data '{"profile":"natural","engine":"linguistic","style_profile":"natural_student"}' \
  "$BASE/rewrite/$JOB_ID" >"$TMP/rewrite.json"
python - "$TMP/rewrite.json" "$TMP/reinsert-request.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"] is True, payload
assert payload["engine"] == "linguistic", payload
assert payload["ml_used"] is False, payload
assert payload["validation"]["valid"] is True, payload
assert payload["edited_texts"], payload
json.dump({"edited_texts": payload["edited_texts"]}, open(sys.argv[2], "w", encoding="utf-8"))
PY

echo "[processor-smoke] DOCX validation"
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data-binary "@$TMP/reinsert-request.json" \
  "$BASE/validate/$JOB_ID" >"$TMP/validation.json"
python - "$TMP/validation.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["valid"] is True, payload
assert payload["can_reinsert"] is True, payload
PY

echo "[processor-smoke] DOCX reinsertion"
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data-binary "@$TMP/reinsert-request.json" \
  "$BASE/reinsert/$JOB_ID" >"$TMP/reinsert.json"
DOWNLOAD_URL="$(python - "$TMP/reinsert.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"] is True, payload
assert payload["download_url"].endswith("/4_org_fin/4_org_fin.docx"), payload
print(payload["download_url"])
PY
)"
curl --fail --silent --show-error "$BASE$DOWNLOAD_URL" -o "$TMP/reinserted.docx"
unzip -t "$TMP/reinserted.docx" >/dev/null

echo "[processor-smoke] formatting analysis"
curl --fail --silent --show-error \
  -F 'docx_file=@docs/sample_1_org.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  "$BASE/formatting/analyse" >"$TMP/formatting.html"
FORMAT_JOB="$(python - "$TMP/formatting.html" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'/formatting/apply/([0-9a-f-]{36})', html)
assert match, "formatting analysis did not expose a formatting job"
print(match.group(1))
PY
)"

echo "[processor-smoke] formatting apply"
curl --fail --silent --show-error \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'body_font=Arial&body_size=11&heading_font=Arial&page_numbers=on&repeat_header=on&bold_table_header=on' \
  "$BASE/formatting/apply/$FORMAT_JOB" >"$TMP/formatting-result.html"
FORMAT_URL="$(python - "$TMP/formatting-result.html" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'href="(/download/[0-9a-f-]{36}/formatted/[^"]+\.docx)"', html)
assert match, "formatting result did not expose a DOCX download"
print(match.group(1))
PY
)"
curl --fail --silent --show-error "$BASE$FORMAT_URL" -o "$TMP/formatted.docx"
unzip -t "$TMP/formatted.docx" >/dev/null

echo "[processor-smoke] PASS: health, text rewrite, detection, DOCX extraction/rewrite/validation/reinsertion, formatting"
