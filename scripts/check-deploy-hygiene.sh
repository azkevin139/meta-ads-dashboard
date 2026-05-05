#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

required_files=(
  "server/index.js"
  "server/app.js"
  "server/worker.js"
  "server/services/aiBackendSettingsService.js"
  "sql/v27_ai_backend_settings.sql"
  "public/index.html"
  "public/client-report.html"
)

missing=0
for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required deploy file: $file" >&2
    missing=1
  fi
done

if (( missing )); then
  exit 1
fi

untracked_required="$(
  git status --short -- "${required_files[@]}" \
    | awk '$1 == "??" { print $2 }'
)"

if [[ -n "$untracked_required" ]]; then
  echo "Required deploy files are untracked:" >&2
  echo "$untracked_required" >&2
  echo "Commit or intentionally remove these files before deploy." >&2
  exit 1
fi

echo "Deploy hygiene check passed."
