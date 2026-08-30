#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
HOST="${AUTUMN_COMPASS_HOST:-127.0.0.1}"
PORT="${AUTUMN_COMPASS_PORT:-5173}"
API_HOST="${AUTUMN_COMPASS_API_HOST:-127.0.0.1}"
API_PORT="${AUTUMN_COMPASS_API_PORT:-4174}"
MODE="${1:-restart}"

case "${MODE}" in
  restart|--start-only|--stop-only) ;;
  *)
    printf '用法：%s [--start-only|--stop-only]\n' "${0##*/}" >&2
    exit 2
    ;;
esac

case "${HOST}" in
  127.0.0.1) ;;
  localhost) HOST='127.0.0.1' ;;
  *)
    printf '错误：Web 管理端必须监听 127.0.0.1；跨设备请转发 Web 端口，不要使用 %s。\n' "${HOST}" >&2
    exit 2
    ;;
esac
case "${API_HOST}" in
  127.0.0.1) ;;
  localhost) API_HOST='127.0.0.1' ;;
  *)
    printf '错误：数据 API 必须监听 127.0.0.1。\n' >&2
    exit 2
    ;;
esac

for port_value in "${PORT}" "${API_PORT}"; do
  if [[ ! "${port_value}" =~ ^[0-9]+$ ]] || (( port_value < 1 || port_value > 65535 )); then
    printf '错误：Web/API 端口必须是 1–65535 之间的整数。\n' >&2
    exit 2
  fi
done

for command_name in npm curl lsof setsid flock sha256sum; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    printf '错误：缺少命令 %s。请先安装后重试。\n' "${command_name}" >&2
    exit 2
  fi
done

STATE_ROOT="${XDG_STATE_HOME:-${HOME:?未设置 HOME}/.local/state}"
PROJECT_KEY="$(printf '%s' "${PROJECT_ROOT}" | sha256sum | cut -c1-12)"
STATE_DIR="${STATE_ROOT}/fall-recruitment/${PROJECT_KEY}/${PORT}-${API_PORT}"
PID_FILE="${STATE_DIR}/web-dev.pid"
LOG_FILE="${STATE_DIR}/web-dev.log"
LOCK_FILE="${STATE_DIR}/restart.lock"
CHECK_HOST="${HOST}"

mkdir -p -- "${STATE_DIR}"
chmod 700 -- "${STATE_DIR}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  printf '错误：另一个重启任务正在执行，请稍后再试。\n' >&2
  exit 1
fi

listener_pids() {
  local target_port="$1"
  lsof -nP -t -iTCP:"${target_port}" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

is_project_process() {
  local process_id="$1"
  local process_cwd process_command
  [[ "${process_id}" =~ ^[0-9]+$ ]] || return 1
  [[ -d "/proc/${process_id}" ]] || return 1
  process_cwd="$(readlink -f "/proc/${process_id}/cwd" 2>/dev/null || true)"
  case "${process_cwd}" in
    "${PROJECT_ROOT}"|"${PROJECT_ROOT}"/*) ;;
    *) return 1 ;;
  esac
  process_command="$(tr '\0' ' ' < "/proc/${process_id}/cmdline" 2>/dev/null || true)"
  [[ "${process_command}" == *vite* || "${process_command}" == *"npm run dev"* || "${process_command}" == *"apps/server"* || "${process_command}" == *"src/index.mjs"* || "${process_command}" == *"dev-stack.sh"* ]]
}

stop_existing_server() {
  local process_id managed_pid managed_pgid
  local -a processes=()
  mapfile -t processes < <({ listener_pids "${PORT}"; listener_pids "${API_PORT}"; } | sort -u)
  if (( ${#processes[@]} == 0 )); then
    rm -f -- "${PID_FILE}"
    return
  fi

  for process_id in "${processes[@]}"; do
    if ! is_project_process "${process_id}"; then
      printf '错误：Web/API 端口被非本项目进程 PID %s 占用，已拒绝停止。\n' "${process_id}" >&2
      exit 1
    fi
  done

  printf '正在停止旧服务（PID %s）…\n' "${processes[*]}"
  managed_pid="$(head -n 1 "${PID_FILE}" 2>/dev/null || true)"
  managed_pgid="$(ps -o pgid= -p "${managed_pid}" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "${managed_pid}" && "${managed_pgid}" == "${managed_pid}" ]] && is_project_process "${managed_pid}"; then
    kill -TERM -- "-${managed_pgid}" 2>/dev/null || true
  else
    kill -TERM -- "${processes[@]}" 2>/dev/null || true
  fi
  for _ in {1..50}; do
    [[ -z "$(listener_pids "${PORT}")$(listener_pids "${API_PORT}")" ]] && break
    sleep 0.1
  done

  mapfile -t processes < <({ listener_pids "${PORT}"; listener_pids "${API_PORT}"; } | sort -u)
  if (( ${#processes[@]} > 0 )); then
    for process_id in "${processes[@]}"; do
      if ! is_project_process "${process_id}"; then
        printf '错误：停止期间 Web/API 端口被其他进程 PID %s 接管。\n' "${process_id}" >&2
        exit 1
      fi
    done
    printf '旧服务未及时退出，正在强制结束本项目进程…\n'
    kill -KILL -- "${processes[@]}" 2>/dev/null || true
  fi
  rm -f -- "${PID_FILE}"
}

start_server() {
  local server_pid
  printf '\n[%s] restart: web=%s:%s api=%s:%s\n' "$(date -Is)" "${HOST}" "${PORT}" "${API_HOST}" "${API_PORT}" >> "${LOG_FILE}"
  cd -- "${PROJECT_ROOT}"
  AUTUMN_COMPASS_HOST="${HOST}" AUTUMN_COMPASS_PORT="${PORT}" AUTUMN_COMPASS_API_HOST="${API_HOST}" AUTUMN_COMPASS_API_PORT="${API_PORT}" \
    nohup setsid npm run dev >> "${LOG_FILE}" 2>&1 < /dev/null 9>&- &
  server_pid=$!
  printf '%s\n' "${server_pid}" > "${PID_FILE}"
  chmod 600 -- "${PID_FILE}" "${LOG_FILE}"
  printf '%s' "${server_pid}"
}

if [[ "${MODE}" == '--start-only' ]]; then
  mapfile -t existing_processes < <({ listener_pids "${PORT}"; listener_pids "${API_PORT}"; } | sort -u)
  if (( ${#existing_processes[@]} > 0 )); then
    for process_id in "${existing_processes[@]}"; do
      if ! is_project_process "${process_id}"; then
        printf '错误：Web/API 端口被非本项目进程 PID %s 占用，无法启动。\n' "${process_id}" >&2
        exit 1
      fi
    done
    if curl -fsS --max-time 1 "http://${CHECK_HOST}:${PORT}/" >/dev/null 2>&1 \
      && curl -fsS --max-time 1 "http://${CHECK_HOST}:${PORT}/api/health" >/dev/null 2>&1; then
      printf '秋招罗盘已经在运行：http://%s:%s/（PID %s）\n' "${CHECK_HOST}" "${PORT}" "${existing_processes[*]}"
      exit 0
    fi
    printf '错误：检测到本项目的残缺或不健康服务。请运行 npm run restart 修复。\n' >&2
    exit 1
  fi
else
  stop_existing_server
fi

if [[ "${MODE}" == '--stop-only' ]]; then
  printf '秋招罗盘已停止（Web %s，API %s）。\n' "${PORT}" "${API_PORT}"
  exit 0
fi

printf '正在启动秋招罗盘…\n'
server_pid="$(start_server)"

for _ in {1..80}; do
  if curl -fsS --max-time 1 "http://${CHECK_HOST}:${PORT}/" >/dev/null 2>&1 \
    && curl -fsS --max-time 1 "http://${CHECK_HOST}:${PORT}/api/health" >/dev/null 2>&1; then
    printf '启动成功：http://%s:%s/\n' "${CHECK_HOST}" "${PORT}"
    printf '服务器数据 API 已就绪：http://%s:%s/api/health\n' "${CHECK_HOST}" "${PORT}"
    printf 'PID：%s\n日志：%s\n' "${server_pid}" "${LOG_FILE}"
    exit 0
  fi
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    printf '错误：开发服务器提前退出。最近日志：\n' >&2
    tail -n 30 -- "${LOG_FILE}" >&2 || true
    exit 1
  fi
  sleep 0.25
done

printf '错误：20 秒内未能访问开发服务器。最近日志：\n' >&2
tail -n 30 -- "${LOG_FILE}" >&2 || true
exit 1
