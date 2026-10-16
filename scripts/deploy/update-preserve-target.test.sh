#!/usr/bin/env bash
# Exercise the actual update/capacity/image-selection path with only host side effects mocked.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$here/install.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
root="$work/source"
deploy="$root/deploy"
mkdir -p "$deploy"
printf 'DOCOO_VERSION=v0.27.4\n' > "$deploy/.env"
printf 'TEST_SECRET=private-fixture-only\n' > "$deploy/.env.production"
printf 'unchanged-commit\n' > "$root/head"
chmod 600 "$deploy/.env" "$deploy/.env.production"
before=$(sha256sum "$deploy/.env" "$deploy/.env.production" "$root/head")
DOCOO_UPDATE_REF=v0.27.6
removed=()
steps=()
say() { :; }
git() { steps+=("git:$3"); [ "$3" = fetch ]; }
docker_free_gb() { echo 7; }
docker() {
  case "$1" in
    ps) printf '%s\n' current-container stopped-container ;;
    inspect) printf '%s\n' sha256:current sha256:stopped ;;
    images) printf '%s\n' docoo-api:v0.27.4 docoo-web:v0.27.3 docoo-api:v0.27.6 docoo-web:v0.27.6 docoo-api:v0.27.3 other-app:v0.27.3 docoo-issues-helper:v0.27.3 ;;
    image)
      [ "$2" = inspect ] || return 91
      case "${@: -1}" in
        docoo-api:v0.27.4) echo sha256:current ;;
        docoo-web:v0.27.3) echo sha256:stopped ;;
        *) printf 'sha256:%s\n' "${@: -1}" ;;
      esac ;;
    rmi) removed+=("$2") ;;
    *) echo 'Unexpected Docker operation' >&2; return 92 ;;
  esac
}
start() { steps+=(start); return 93; }
if update > "$work/update.log" 2>&1; then status=0; else status=$?; fi
failures=0
checks=0
check_equal() {
  checks=$((checks+1))
  if [ "$1" != "$2" ]; then
    printf 'FAIL %s\n  expected: %s\n  actual: %s\n' "$3" "$1" "$2"
    failures=$((failures+1))
  fi
}
check_equal 24 "$min_free_gb" 'full-build capacity guard retained'
check_equal 5 "$build_reserve_gb" 'build reserve retained'
check_equal 75 "$status" 'low capacity refuses before installing'
check_equal docoo-api:v0.27.3 "${removed[*]}" 'only unused old release removed; staged target, current/stopped and unrelated images retained'
check_equal git:fetch "${steps[*]}" 'no checkout, build or service recreation'
check_equal "$before" "$(sha256sum "$deploy/.env" "$deploy/.env.production" "$root/head")" 'source and private configuration unchanged'
check_equal 600 "$(stat -c %a "$deploy/.env.production")" 'private configuration permissions retained'
check_equal 0 "$(find "$deploy" -name '.env.update-rollback.*' | wc -l | tr -d ' ')" 'no update snapshot or partial installation'
printf '%s checks, %s failed\n' "$checks" "$failures"
[ "$failures" = 0 ]
