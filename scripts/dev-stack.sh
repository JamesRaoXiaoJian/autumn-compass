#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
WEB_HOST="${AUTUMN_COMPASS_HOST:-127.0.0.1}"
WEB_PORT="${AUTUMN_COMPASS_PORT:-5173}"
API_HOST="${AUTUMN_COMPASS_API_HOST:-127.0.0.1}"
API_PORT="${AUTUMN_COMPASS_API_PORT:-4174}"
server_pid=''
web_pid=''

case "${WEB_HOST}" in
  127.0.0.1) ;;
  localhost) WEB_HOST='127.0.0.1' ;;
  *)
    printf '错误：Web 管理端必须监听 127.0.0.1；跨设备请转发 Web 端口，不要使用 %s。\n' "${WEB_HOST}" >&2
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

for port_value in "${WEB_PORT}" "${API_PORT}"; do
  if [[ ! "${port_value}" =~ ^[0-9]+$ ]] || (( port_value < 1 || port_value > 65535 )); then
    printf '错误：Web/API 端口必须是 1–65535 之间的整数。\n' >&2
    exit 2
  fi
done

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${web_pid}" ]] && kill -TERM "${web_pid}" 2>/dev/null || true
  [[ -n "${server_pid}" ]] && kill -TERM "${server_pid}" 2>/dev/null || true
  [[ -n "${web_pid}" ]] && wait "${web_pid}" 2>/dev/null || true
  [[ -n "${server_pid}" ]] && wait "${server_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd -- "${PROJECT_ROOT}"
printf '启动服务器数据层：http://%s:%s\n' "${API_HOST}" "${API_PORT}"
AUTUMN_COMPASS_API_HOST="${API_HOST}" AUTUMN_COMPASS_API_PORT="${API_PORT}" npm run dev -w @autumn-compass/server &
server_pid=$!

api_check_host="${API_HOST}"

for _ in {1..80}; do
  if curl -fsS --max-time 1 "http://${api_check_host}:${API_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    printf '错误：服务器数据层启动失败。\n' >&2
    exit 1
  fi
  sleep 0.25
done
if ! curl -fsS --max-time 1 "http://${api_check_host}:${API_PORT}/api/health" >/dev/null 2>&1; then
  printf '错误：20 秒内未能连接服务器数据层。\n' >&2
  exit 1
fi

printf '启动 Web 管理端：http://%s:%s\n' "${WEB_HOST}" "${WEB_PORT}"
AUTUMN_COMPASS_API_PORT="${API_PORT}" npm run dev -w @autumn-compass/web -- --host "${WEB_HOST}" --port "${WEB_PORT}" --strictPort &
web_pid=$!

set +e
wait -n "${server_pid}" "${web_pid}"
exit_code=$?
set -e
printf '开发服务已退出（code=%s），正在清理关联进程。\n' "${exit_code}" >&2
exit "${exit_code}"
