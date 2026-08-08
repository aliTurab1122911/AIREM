#!/usr/bin/env bash
set -euo pipefail
base=https://localhost:8443
cookies=$(mktemp)
upload_response=$(mktemp)
download_before=$(mktemp)
download_after=$(mktemp)
trap 'rm -f "$cookies" "$upload_response" "$download_before" "$download_after"' EXIT
curl --fail --silent --show-error --insecure "$base/" >/dev/null
curl --fail --silent --show-error --insecure -c "$cookies" \
  -H 'content-type: application/json' \
  --data '{"email":"smoke@example.test","password":"correct horse battery staple"}' \
  "$base/api/auth/register" >/dev/null
curl --fail --silent --show-error --insecure -b "$cookies" \
  "$base/api/auth/session" | python -c 'import json,sys; assert json.load(sys.stdin)["user"]["email"] == "smoke@example.test"'

# Prove processor job data and gateway ownership survive a container replacement.
curl --fail --silent --show-error --insecure -b "$cookies" \
  -F 'docx_file=@docs/sample_1_org.docx' \
  "$base/api/documents/upload" >"$upload_response"
job_id=$(python -c 'import json,re,sys; data=json.load(open(sys.argv[1])); match=re.search(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", data["html"], re.I); assert match; print(match.group(0))' "$upload_response")
curl --fail --silent --show-error --insecure -b "$cookies" \
  "$base/api/documents/download/$job_id/1_org/sample_1_org.docx" >"$download_before"

docker compose up -d --force-recreate processor
docker compose up --wait --no-deps processor

curl --fail --silent --show-error --insecure -b "$cookies" \
  "$base/api/documents/jobs/$job_id" |
  python -c 'import json,sys; data=json.load(sys.stdin); assert data["representation"] == "legacy-html"; assert sys.argv[1] in data["html"]' "$job_id"
curl --fail --silent --show-error --insecure -b "$cookies" \
  "$base/api/documents/download/$job_id/1_org/sample_1_org.docx" >"$download_after"
cmp "$download_before" "$download_after"

# Exercise the browser-facing proxy route against the account service for both
# an existing and an unknown address. Both responses must remain indistinguishable.
for email in smoke@example.test unknown@example.test; do
  curl --fail --silent --show-error --insecure \
    -H 'content-type: application/json' \
    --data "{\"email\":\"$email\"}" \
    "$base/api/auth/password-reset/request" |
    python -c 'import json,sys; assert json.load(sys.stdin) == {"ok": True}'
done
