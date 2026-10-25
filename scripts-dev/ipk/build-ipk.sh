#!/usr/bin/env bash
# Build qmanager-build/sdxpinn-qmanager_<ver>_sdxpinn.ipk from the release
# tarball (run `bun run package` first; `bun run package:ipk` does both).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then
    PY="$c"
    break
  fi
done
[ -n "$PY" ] || { echo "build-ipk: Python 3.8+ not found" >&2; exit 1; }

cd "$ROOT_DIR"
EPOCH="$(git log -1 --format=%ct 2>/dev/null || date +%s)"
"$PY" scripts-dev/ipk/assemble_ipk_source.py
"$PY" scripts-dev/ipk/build_ipk.py qmanager-build/ipk-source/sdxpinn-qmanager --out qmanager-build --epoch "$EPOCH"
"$PY" scripts-dev/ipk/check_ipk.py qmanager-build
