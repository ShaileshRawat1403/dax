#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec env DAX_CONFIG=.dax/dax.jsonc bun run --cwd packages/dax src/index.ts "$@"
