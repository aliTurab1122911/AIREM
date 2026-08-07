#!/usr/bin/env bash
set -euo pipefail
base=https://localhost:8443
cookies=$(mktemp)
trap 'rm -f "$cookies"' EXIT
curl --fail --silent --show-error --insecure "$base/" >/dev/null
curl --fail --silent --show-error --insecure -c "$cookies" \
  -H 'content-type: application/json' \
  --data '{"email":"smoke@example.test","password":"correct horse battery staple"}' \
  "$base/api/auth/register" >/dev/null
curl --fail --silent --show-error --insecure -b "$cookies" \
  "$base/api/auth/session" | python -c 'import json,sys; assert json.load(sys.stdin)["user"]["email"] == "smoke@example.test"'
