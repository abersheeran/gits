#!/bin/sh
set -eu

DOCKER_LOG_FILE="/tmp/dockerd.log"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export XDG_RUNTIME_DIR="${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"

if [ -z "${DOCKER_HOST:-}" ]; then
  export DOCKER_HOST="unix://${RUNTIME_DIR}/docker.sock"
fi

# Cloudflare Containers recommends disabling iptables/ip6tables for DinD.
dockerd-entrypoint.sh dockerd --iptables=false --ip6tables=false >"${DOCKER_LOG_FILE}" 2>&1 &
docker_pid="$!"

# Wait for daemon readiness so actions can run docker immediately.
until docker version >/dev/null 2>&1; do
  if ! kill -0 "${docker_pid}" 2>/dev/null; then
    echo "dockerd exited before becoming ready" >&2
    cat "${DOCKER_LOG_FILE}" >&2 || true
    exit 1
  fi
  sleep 0.2
done

exec node /opt/actions-runner/server.js
