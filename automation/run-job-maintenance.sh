#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly CODEX_BIN="${CODEX_BIN:-$(command -v codex || true)}"
readonly PROMPT_FILE="${PROJECT_DIR}/automation/job-maintenance-prompt.md"
readonly LAST_MESSAGE="${PROJECT_DIR}/maintenance/latest-agent-report.md"
readonly LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/fall-recruitment-maintenance.lock"

if [[ "${1:-}" == "--check" ]]; then
  test -n "${CODEX_BIN}"
  test -x "${CODEX_BIN}"
  test -r "${PROMPT_FILE}"
  "${CODEX_BIN}" login status
  exit 0
fi

if [[ -z "${CODEX_BIN}" || ! -x "${CODEX_BIN}" ]]; then
  echo "Codex CLI was not found on PATH. Install Codex and sign in first." >&2
  exit 127
fi

cd "${PROJECT_DIR}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Recruitment maintenance is already running." >&2
  exit 75
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Recruitment maintenance skipped because the working tree is not clean." >&2
  exit 75
fi

exec "${CODEX_BIN}" \
  --search \
  --ask-for-approval never \
  exec \
  --ephemeral \
  --sandbox workspace-write \
  --color never \
  --output-last-message "${LAST_MESSAGE}" \
  - < "${PROMPT_FILE}"
