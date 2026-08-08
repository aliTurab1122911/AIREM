#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
clean_context=$(mktemp -d)
trap 'rm -rf "$clean_context"' EXIT INT TERM

# Construct the context from source files only so ignored local build artifacts
# can never make a broken Dockerfile appear to work.
tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  -C "$repo_root" -cf - . | tar -C "$clean_context" -xf -

if find "$clean_context" -type d \( -name node_modules -o -name dist \) -print -quit | grep -q .; then
  echo "clean Docker context unexpectedly contains node_modules or dist" >&2
  exit 1
fi

docker build "$@" -f "$clean_context/services/gateway/Dockerfile" "$clean_context"
