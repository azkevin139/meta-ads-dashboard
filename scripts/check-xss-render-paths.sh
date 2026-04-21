#!/usr/bin/env bash
set -euo pipefail

if rg "innerHTML\s*=.*err\.message|setDrawerBody\(.*err\.message|onError:.*err\.message" public/js; then
  echo "Unsafe err.message HTML interpolation found. Use safeErrorMessage(err)." >&2
  exit 1
fi

escape_defs="$(rg "function escapeHtml" public/js | wc -l | tr -d ' ')"
if [ "$escape_defs" != "1" ]; then
  echo "Expected exactly one escapeHtml implementation in public/js; found $escape_defs." >&2
  exit 1
fi
