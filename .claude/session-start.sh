#!/usr/bin/env bash
# Prepares Claude Code cloud sessions: Node 24 + pnpm 12 (per .nvmrc/engines),
# a running Docker daemon for the Compose stack, and installed dependencies.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"
NODE_MAJOR="$(tr -d '[:space:]' < .nvmrc)"
NODE_DIR="/opt/node${NODE_MAJOR}"

if [ ! -x "${NODE_DIR}/bin/node" ]; then
  version="$(curl -fsSL https://nodejs.org/dist/index.json \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).find(r=>r.version.startsWith('v${NODE_MAJOR}.')).version))")"
  curl -fsSL "https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.xz" | tar -xJ -C /opt
  mv "/opt/node-${version}-linux-x64" "${NODE_DIR}"
fi
export PATH="${NODE_DIR}/bin:${PATH}"
pnpm_version="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [ "$("${NODE_DIR}/bin/pnpm" --version 2>/dev/null || true)" != "${pnpm_version}" ]; then
  npm install -g --silent "pnpm@${pnpm_version}"
fi
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${NODE_DIR}/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE}"
fi

if command -v dockerd >/dev/null && ! docker info >/dev/null 2>&1; then
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

[ -f .env ] || pnpm env:setup
pnpm install --frozen-lockfile
