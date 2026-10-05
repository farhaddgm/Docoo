#!/usr/bin/env bash
# Tests of the judgements in acceptance.sh without Docker, a database or a network: each
# judge_* function gets what the server would print and must answer PASS, WARN, ACTION,
# FAIL or UNKNOWN with evidence the owner can read. The report is checked on recorded rows.
#
#   bash scripts/deploy/acceptance.test.sh
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/acceptance.sh"
set +e

failures=0
checks=0
assert_eq() { # assert_eq EXPECTED ACTUAL NAME
  checks=$((checks + 1))
  if [ "$1" != "$2" ]; then
    failures=$((failures + 1))
    printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$3" "$1" "$2"
  fi
}
assert_contains() { # assert_contains HAYSTACK NEEDLE NAME
  checks=$((checks + 1))
  case "$1" in
    *"$2"*) ;;
    *)
      failures=$((failures + 1))
      printf 'FAIL %s\n  missing: %s\n  in: %s\n' "$3" "$2" "$1"
      ;;
  esac
}
status_of() { printf '%s' "${1%%|*}"; }

bash -n "$here/acceptance.sh" || { echo 'FAIL acceptance.sh has a syntax error'; exit 1; }

# ---- services -----------------------------------------------------------------------------
healthy='postgres|running|healthy
redis|running|healthy
object-store|running|healthy
clamav|running|healthy
temporal|running|healthy
api|running|healthy
web|running|healthy
worker-agent|running|
worker-ingestion|running|
caddy|running|
migrate|exited|'
assert_eq PASS "$(status_of "$(judge_services "$healthy" '')")" 'services: all running'
assert_eq FAIL "$(status_of "$(judge_services "$healthy" 'docoo/prod')")" 'services: backup needed when a location is set but missing'
assert_contains "$(judge_services "$healthy" 'docoo/prod')" 'backup (missing)' 'services: names the missing backup container'
withbackup="$healthy
backup|running|"
assert_eq PASS "$(status_of "$(judge_services "$withbackup" 'docoo/prod')")" 'services: backup running'

unhealthy=${healthy/api|running|healthy/api|running|unhealthy}
assert_eq FAIL "$(status_of "$(judge_services "$unhealthy" '')")" 'services: unhealthy api'
assert_contains "$(judge_services "$unhealthy" '')" 'api (unhealthy)' 'services: names the unhealthy one'
stopped=${healthy/web|running|healthy/web|exited|}
assert_contains "$(judge_services "$stopped" '')" 'web (exited)' 'services: names the stopped one'
missing=$(printf '%s\n' "$healthy" | grep -v '^caddy|')
assert_contains "$(judge_services "$missing" '')" 'caddy (missing)' 'services: names a missing one'
# `api` must not be matched by `api-something`; the prefix test needs the separator
prefixed=${healthy/api|running|healthy/api-old|running|healthy}
assert_contains "$(judge_services "$prefixed" '')" 'api (missing)' 'services: no prefix matches'

# ---- disk ---------------------------------------------------------------------------------
min_free_gb=10
assert_eq PASS "$(status_of "$(judge_disk 40)")" 'disk: plenty'
assert_eq PASS "$(status_of "$(judge_disk 10)")" 'disk: exactly the minimum'
assert_eq WARN "$(status_of "$(judge_disk 7)")" 'disk: below the minimum'
assert_eq FAIL "$(status_of "$(judge_disk 2)")" 'disk: nearly full'
assert_eq UNKNOWN "$(status_of "$(judge_disk '')")" 'disk: unreadable'

# ---- release ------------------------------------------------------------------------------
assert_eq PASS "$(status_of "$(judge_version v0.16.0 v0.16.0)")" 'version: current'
assert_eq WARN "$(status_of "$(judge_version v0.15.0 v0.16.0)")" 'version: behind'
assert_eq UNKNOWN "$(status_of "$(judge_version v0.15.0 '')")" 'version: no tag known'
assert_contains "$(judge_version '' '')" 'unknown' 'version: nothing known'

# ---- https --------------------------------------------------------------------------------
assert_eq PASS "$(status_of "$(judge_https 200 60)")" 'https: ok and valid certificate'
assert_eq PASS "$(status_of "$(judge_https 307 60)")" 'https: redirect to login is fine'
assert_eq WARN "$(status_of "$(judge_https 200 9)")" 'https: certificate close to expiry'
assert_eq FAIL "$(status_of "$(judge_https 200 -1)")" 'https: expired certificate'
assert_eq WARN "$(status_of "$(judge_https 200 '')")" 'https: expiry unreadable'
assert_eq FAIL "$(status_of "$(judge_https 502 60)")" 'https: bad gateway'
assert_eq FAIL "$(status_of "$(judge_https '' 60)")" 'https: no answer'
assert_contains "$(judge_https 000 60)" 'answered 000' 'https: connection failure code is shown'

# ---- AI connections -----------------------------------------------------------------------
assert_eq PASS "$(status_of "$(judge_providers 'openai|healthy|1')")" 'providers: one healthy real'
assert_eq PASS "$(status_of "$(judge_providers $'anthropic|healthy|1\nopenai|failed|1')")" 'providers: one healthy is enough'
assert_eq WARN "$(status_of "$(judge_providers $'fake|healthy|1\nopenai|healthy|1')")" 'providers: offline connection next to a real one'
assert_eq FAIL "$(status_of "$(judge_providers 'openai|failed|1')")" 'providers: real but unhealthy'
assert_eq ACTION "$(status_of "$(judge_providers 'fake|healthy|1')")" 'providers: only the offline one means no real key yet'

assert_eq PASS "$(status_of "$(judge_prices 'openai|2')")" 'prices: entered'
assert_eq PASS "$(status_of "$(judge_prices $'anthropic|1\nopenai|3')")" 'prices: entered for every provider'
assert_eq WARN "$(status_of "$(judge_prices 'openai|0')")" 'prices: none entered'
assert_contains "$(judge_prices $'anthropic|1\nopenai|0')" 'no price entered for openai' 'prices: names the provider without one'
assert_eq WARN "$(status_of "$(judge_prices $'gemini|0\nopenai|0')")" 'prices: several providers without one'
assert_eq ACTION "$(status_of "$(judge_providers '')")" 'providers: nothing configured'
assert_contains "$(judge_providers 'openai|failed|2')" '2 real' 'providers: counts connections'

# ---- backups ------------------------------------------------------------------------------
assert_eq ACTION "$(status_of "$(judge_backup '' '')")" 'backup: no location'
assert_eq WARN "$(status_of "$(judge_backup 's3://b/docoo' '')")" 'backup: configured, none listed yet'
listing=$'name modified wal_segment_backup_start\nbase_0001 2026-10-01T02:00:00Z 000000010000000000000004\nbase_0002 2026-10-02T02:00:00Z 000000010000000000000008\n'
assert_eq PASS "$(status_of "$(judge_backup 's3://b/docoo' "$listing")")" 'backup: base backups listed'
assert_contains "$(judge_backup 's3://b/docoo' "$listing")" 'base_0002' 'backup: shows the newest'

# ---- nightly update, administrator, mail --------------------------------------------------
assert_eq PASS "$(status_of "$(judge_auto_update on active)")" 'auto-update: on and active'
assert_eq WARN "$(status_of "$(judge_auto_update on inactive)")" 'auto-update: timer stopped'
assert_eq WARN "$(status_of "$(judge_auto_update off active)")" 'auto-update: switched off'
assert_eq WARN "$(status_of "$(judge_auto_update on '')")" 'auto-update: no systemd'
assert_eq PASS "$(status_of "$(judge_admin 1)")" 'admin: one'
assert_eq FAIL "$(status_of "$(judge_admin 0)")" 'admin: none'
assert_eq UNKNOWN "$(status_of "$(judge_admin '')")" 'admin: unreadable'
assert_eq PASS "$(status_of "$(judge_mail yes)")" 'mail: configured'
assert_eq ACTION "$(status_of "$(judge_mail no)")" 'mail: not configured'

# ---- the report ---------------------------------------------------------------------------
env_value() { case "$1" in DOMAIN) echo docoo.example.org ;; DOCOO_VERSION) echo v0.16.0 ;; esac; }

results=()
record PASS 'Release' 'running the latest release v0.16.0'
record ACTION 'AI connection' 'no real AI key yet'
out=$(report)
status=$?
assert_eq 0 "$status" 'report: no failure exits 0'
assert_contains "$out" '| Release | PASS | running the latest release v0.16.0 |' 'report: row'
assert_contains "$out" '1 passed, 0 warning(s), 1 for the owner, 0 failed, 0 unknown.' 'report: summary line'
assert_contains "$out" 'docoo.example.org' 'report: names the server'
assert_contains "$out" 'pnpm owner:check' 'report: lists the owner-only GitHub check'
assert_contains "$out" 'REL-002' 'report: has the sign-off block'

record FAIL 'Containers' 'not healthy: api (unhealthy)'
record UNKNOWN 'Disk' 'disk space could not be read'
out=$(report)
status=$?
assert_eq 1 "$status" 'report: a failure exits 1'
assert_contains "$out" '1 passed, 0 warning(s), 1 for the owner, 1 failed, 1 unknown.' 'report: counts every status'

# an evidence text with a pipe must not break the table's columns
results=()
record WARN 'Backups' 'a | b'
out=$(report)
assert_contains "$out" '| Backups | WARN | a \| b |' 'report: pipe in evidence is escaped'

if [ "$failures" -gt 0 ]; then
  printf '\n%s of %s checks failed\n' "$failures" "$checks"
  exit 1
fi
printf 'acceptance.sh: %s checks passed\n' "$checks"
