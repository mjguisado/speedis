#!/bin/bash
#
# Loads the Speedis main configuration and every per-origin configuration
# under ./origins/ into Redis under the keys expected by Speedis when
# USE_REDIS_CONFIG is enabled.
#
# Key layout:
#   speedis:config:main                  → ./speedis.json
#   speedis:config:origins:<filename>    → ./origins/<filename>.json
#
# The Redis URL can be overridden via the REDIS_URL environment variable.
# Default: redis://redis:6379 (Docker Compose / Kubernetes service name).
#
# Usage:
#   ./loadConfigsToRedis.sh
#   REDIS_URL=redis://localhost:6379 ./loadConfigsToRedis.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDIS_URL="${REDIS_URL:-redis://redis:6379}"

echo "Target Redis: ${REDIS_URL}"

# Main configuration
if [[ -f "${DIR}/speedis.json" ]]; then
    echo "Loading speedis.json → speedis:config:main"
    redis-cli -u "${REDIS_URL}" -x JSON.SET 'speedis:config:main' . < "${DIR}/speedis.json"
else
    echo "Warning: ${DIR}/speedis.json not found, skipping main config." >&2
fi

# Per-origin configurations
ORIGINS_DIR="${DIR}/origins"
if [[ -d "${ORIGINS_DIR}" ]]; then
    shopt -s nullglob
    for origin_file in "${ORIGINS_DIR}"/*.json; do
        origin_name="$(basename "${origin_file}" .json)"
        key="speedis:config:origins:${origin_name}"
        echo "Loading $(basename "${origin_file}") → ${key}"
        redis-cli -u "${REDIS_URL}" -x JSON.SET "${key}" . < "${origin_file}"
    done
    shopt -u nullglob
else
    echo "Warning: ${ORIGINS_DIR} not found, no origin configurations loaded." >&2
fi
