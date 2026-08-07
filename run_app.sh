#!/usr/bin/env bash
cd "$(dirname "$0")"
python -m pip install -r requirements.txt
python app.py
