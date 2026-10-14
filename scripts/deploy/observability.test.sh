#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$here/install.sh"
task_dir=$(mktemp -d /tmp/docoo-observability-test.XXXXXX)
trap 'rm -rf "$task_dir"' EXIT
deploy=$task_dir
printf 'DOCOO_VERSION=v0.27.2\n' >"$deploy/.env"
touch "$deploy/compose.production.yaml" "$deploy/compose.observability.yaml"
compose=(docker compose -f "$deploy/compose.production.yaml")
DOCOO_OBSERVABILITY=0
use_observability
[ "${#compose[@]}" = 4 ]
DOCOO_OBSERVABILITY=1
use_observability
use_observability
[ "${#compose[@]}" = 6 ]
[ "$(env_value DOCOO_OBSERVABILITY)" = 1 ]
DOCOO_OBSERVABILITY=invalid
if use_observability; then echo 'Invalid observability setting accepted'; exit 1; fi
[ "${#compose[@]}" = 6 ]

# A failed first enablement leaves its override in memory. The old release and snapshot lack it.
rm "$deploy/compose.observability.yaml"
printf 'DOCOO_VERSION=v0.27.2\n' >"$deploy/.env"
DOCOO_OBSERVABILITY=1
EDGE_PROXY=''
git() { return 0; }
detect_edge() { return 0; }
wait_healthy() { return 0; }
docker() { printf '%s\n' "$@" >"$task_dir/docker-args"; }
rollback v0.27.2
if grep -q 'compose.observability.yaml' "$task_dir/docker-args"; then echo 'Rollback retained the missing new override'; exit 1; fi
grep -q -- --no-build "$task_dir/docker-args"
[ -z "$DOCOO_OBSERVABILITY" ]
printf 'Observability opt-in, idempotent selection, invalid settings and first-enable rollback: PASS\n'
