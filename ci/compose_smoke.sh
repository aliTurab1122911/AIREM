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

# Exercise the browser-facing proxy route against the account service for both
# an existing and an unknown address. Both responses must remain indistinguishable.
for email in smoke@example.test unknown@example.test; do
  curl --fail --silent --show-error --insecure \
    -H 'content-type: application/json' \
    --data "{\"email\":\"$email\"}" \
    "$base/api/auth/password-reset/request" |
    python -c 'import json,sys; assert json.load(sys.stdin) == {"ok": True}'
done
