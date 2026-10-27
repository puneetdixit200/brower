#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"

if ! command -v bun >/dev/null 2>&1 && [[ -x "${HOME}/.local/bin/bun" ]]; then
	PATH="${HOME}/.local/bin:${PATH}"
	export PATH
fi
if ! command -v go >/dev/null 2>&1 && [[ -x "${HOME}/.local/opt/go/bin/go" ]]; then
	PATH="${HOME}/.local/opt/go/bin:${PATH}"
	export PATH
fi

if ! command -v bun >/dev/null 2>&1; then
	echo "Bun is required. Install the repo-pinned version from packages/browseros-agent/package.json." >&2
	exit 1
fi
if ! command -v go >/dev/null 2>&1; then
	echo "Go is required. Install it from https://go.dev/dl/ or add its bin directory to PATH." >&2
	exit 1
fi

browser_bin="${ASTER_BROWSER_BIN:-${ASTER_BROWSER_BINARY:-${BROWSEROS_BINARY:-}}}"
if [[ -z "${browser_bin}" ]]; then
	browser_bin="$(command -v browseros || true)"
fi
if [[ -z "${browser_bin}" ]]; then
	echo "Set ASTER_BROWSER_BIN to a BrowserOS-compatible Linux binary or AppImage." >&2
	exit 1
fi
if [[ "${browser_bin}" == */* && ! -x "${browser_bin}" ]]; then
	echo "Browser binary is not executable: ${browser_bin}" >&2
	exit 1
fi

export ASTER_BROWSER_BIN="${browser_bin}"
if [[ -z "${NODE_OPTIONS:-}" ]]; then
	export NODE_OPTIONS="--max-old-space-size=4096"
fi

cd "${AGENT_ROOT}"
exec "${AGENT_ROOT}/tools/dev/run.sh" watch --manual "$@"
