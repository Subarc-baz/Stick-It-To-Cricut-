#!/usr/bin/env bash
# Serves this folder on http://localhost:8080 (loopback only). Stop with Ctrl+C.
cd "$(dirname "$0")/.." && exec python3 -m http.server 8080 --bind 127.0.0.1
