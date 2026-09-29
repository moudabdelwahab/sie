#!/usr/bin/env bash
# sie-api chat-reply under Deno, with the real engine from this checkout.
#
#   bash supabase/functions/sie-api/tests/deno/run.sh
#
# Needs `deno` (or DENO=/path/to/deno). The two remote imports (supabase-js and
# the pinned engine on jsDelivr) are mapped in import_map.json, so only
# jsr:@std/assert needs the network the first time.
set -euo pipefail
cd "$(dirname "$0")"
DENO_BIN="${DENO:-deno}"
command -v "$DENO_BIN" >/dev/null 2>&1 || { echo "deno is not installed — install it or pass DENO=/path/to/deno" >&2; exit 1; }
exec "$DENO_BIN" test --no-lock --import-map import_map.json --allow-env --allow-read .
