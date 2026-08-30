#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
OUTPUT_DIRECTORY="${1:-${PROJECT_ROOT}/artifacts}"

if [[ -n "$(git -C "${PROJECT_ROOT}" status --porcelain --untracked-files=normal)" ]]; then
  printf 'Refusing to export: commit or review the current working tree first.\n' >&2
  exit 1
fi

cd -- "${PROJECT_ROOT}"
npm run check:public
mkdir -p -- "${OUTPUT_DIRECTORY}"
OUTPUT_DIRECTORY="$(cd -- "${OUTPUT_DIRECTORY}" && pwd -P)"
REVISION="$(git rev-parse --short=12 HEAD)"
ARCHIVE="${OUTPUT_DIRECTORY}/autumn-compass-public-${REVISION}.tar.gz"

git archive --format=tar HEAD | gzip -9 > "${ARCHIVE}"
printf 'Public source snapshot: %s\n' "${ARCHIVE}"
printf 'This archive contains HEAD only and no Git history. Verify it before publishing.\n'
