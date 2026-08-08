#!/bin/sh
set -eu

workers="${PROCESSOR_WORKERS:-2}"
case "$workers" in
  ''|*[!0-9]*|0) echo "PROCESSOR_WORKERS must be a positive integer" >&2; exit 64 ;;
esac

exec gunicorn --bind=0.0.0.0:5000 --workers="$workers" --threads=1 --timeout=120 \
  --graceful-timeout=30 --keep-alive=5 processor_app:app
