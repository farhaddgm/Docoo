#!/usr/bin/env bash
# Acceptance evidence of a running Docoo server for the private-beta sign-off (REL-002, #94;
# docs/06-delivery/12-private-beta-acceptance.md). It only reads: container health, the API,
# HTTPS and its certificate, disk, the release, the nightly update, backups, the administrator
# and the AI connections. It prints a report to paste into the issue and exits 1 when something
# is FAIL. What a server cannot show (branch protection, who the beta users are) is listed for
# the owner at the end.
#
#   sudo ./scripts/deploy/acceptance.sh            # report on stdout
#   sudo ./scripts/deploy/acceptance.sh > acceptance-$(date +%F).md
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Reuses the helpers of the installer (env_value, docker_free_gb, latest_release); sourcing runs nothing.
# shellcheck disable=SC1091
source "$here/install.sh"
set +e # every check reports for itself; one failing command must not end the report

# Containers that must be running (and healthy where they define a check). `migrate` is a
# one-shot job and `backup` only matters when a backup location was given.
required_services="postgres redis object-store clamav temporal api web worker-agent worker-ingestion caddy"

results=()
record() { results+=("$1|$2|$3"); } # record STATUS NAME EVIDENCE

# ---- judgements: pure, so the tests can feed them what a server would print -----------------

judge_services() { # judge_services "service|state|health" lines, BACKUP_S3_PREFIX
  local lines=$1 backup=${2:-} service line state health bad=()
  local want="$required_services"
  [ -n "$backup" ] && want="$want backup"
  for service in $want; do
    line=$(printf '%s\n' "$lines" | grep "^$service|" | head -1)
    state=${line#*|}; state=${state%%|*}
    health=${line##*|}
    if [ -z "$line" ]; then bad+=("$service (missing)")
    elif [ "$state" != running ]; then bad+=("$service ($state)")
    elif [ -n "$health" ] && [ "$health" != healthy ]; then bad+=("$service ($health)")
    fi
  done
  if [ "${#bad[@]}" -eq 0 ]; then printf 'PASS|all running: %s\n' "$want"
  else printf 'FAIL|not healthy: %s\n' "${bad[*]}"; fi
}

judge_disk() { # judge_disk FREE_GB
  local free=$1
  if [ -z "$free" ]; then printf 'UNKNOWN|disk space could not be read\n'
  elif [ "$free" -ge "$min_free_gb" ]; then printf 'PASS|%s GB free where Docker keeps its data\n' "$free"
  elif [ "$free" -ge 5 ]; then printf 'WARN|only %s GB free; an update needs %s GB (see the install guide, section 9)\n' "$free" "$min_free_gb"
  else printf 'FAIL|only %s GB free; updates will stop before changing anything\n' "$free"; fi
}

judge_version() { # judge_version CURRENT LATEST
  if [ -z "$2" ]; then printf 'UNKNOWN|running %s; the latest release could not be read\n' "${1:-unknown}"
  elif [ "$1" = "$2" ]; then printf 'PASS|running the latest release %s\n' "$1"
  else printf 'WARN|running %s; release %s is available (the nightly update installs it)\n' "$1" "$2"; fi
}

judge_https() { # judge_https HTTP_CODE CERT_DAYS_LEFT
  local code=$1 days=$2
  case "$code" in
    2??|3??) ;;
    *) printf 'FAIL|HTTPS answered %s\n' "${code:-nothing}"; return ;;
  esac
  if [ -z "$days" ]; then printf 'WARN|HTTPS answers %s; the certificate expiry could not be read\n' "$code"
  elif [ "$days" -lt 0 ]; then printf 'FAIL|the HTTPS certificate expired\n'
  elif [ "$days" -lt 14 ]; then printf 'WARN|HTTPS answers %s; the certificate expires in %s days (Caddy renews it at 30)\n' "$code" "$days"
  else printf 'PASS|HTTPS answers %s; the certificate is valid for %s more days\n' "$code" "$days"; fi
}

judge_providers() { # judge_providers "provider|status|count" lines
  local rows=$1 real healthy fake
  real=$(printf '%s\n' "$rows" | awk -F'|' '$1 != "" && $1 != "fake" { n += $3 } END { print n + 0 }')
  healthy=$(printf '%s\n' "$rows" | awk -F'|' '$1 != "" && $1 != "fake" && $2 == "healthy" { n += $3 } END { print n + 0 }')
  fake=$(printf '%s\n' "$rows" | awk -F'|' '$1 == "fake" { n += $3 } END { print n + 0 }')
  if [ "$healthy" -ge 1 ]; then
    if [ "$fake" -ge 1 ]; then printf 'WARN|%s healthy real connection(s), but %s offline test connection(s) exist; the offline provider must not serve real projects\n' "$healthy" "$fake"
    else printf 'PASS|%s healthy real AI connection(s)\n' "$healthy"; fi
  elif [ "$real" -ge 1 ]; then printf 'FAIL|%s real connection(s) but none healthy; open "AI providers" and check the key\n' "$real"
  else printf 'ACTION|no real AI key yet; add one on the "AI providers" page and press the health check\n'; fi
}

judge_backup() { # judge_backup PREFIX LIST_OUTPUT
  local prefix=$1 list=$2 last
  if [ -z "$prefix" ]; then printf 'ACTION|no off-host backup location; fill BACKUP_S3_* in deploy/.env and run install.sh update\n'; return; fi
  last=$(printf '%s\n' "$list" | sed '/^$/d' | tail -1)
  if [ -n "$last" ]; then printf 'PASS|off-host backups exist; newest: %s\n' "$last"
  else printf 'WARN|a backup location is set but no base backup is listed yet (the first runs within 24 hours)\n'; fi
}

judge_auto_update() { # judge_auto_update SETTING TIMER_STATE
  if [ "$1" = off ]; then printf 'WARN|the nightly update is switched off; update by hand with install.sh update\n'
  elif [ "$2" = active ]; then printf 'PASS|the nightly update is on and its timer is active\n'
  else printf 'WARN|the nightly update is on but the timer is %s\n' "${2:-unknown}"; fi
}

judge_admin() { # judge_admin ACTIVE_USER_COUNT
  if [ -z "$1" ]; then printf 'UNKNOWN|the administrator could not be read\n'
  elif [ "$1" -ge 1 ]; then printf 'PASS|%s active administrator account(s)\n' "$1"
  else printf 'FAIL|no active administrator\n'; fi
}

judge_mail() { # judge_mail SMTP_URL_SET(yes|no)
  if [ "$1" = yes ]; then printf 'PASS|password-reset mail is configured\n'
  else printf 'ACTION|SMTP is not set; password-reset mail will not be sent (optional for a beta)\n'; fi
}

# ---- collection: each reads one thing and records a judgement -------------------------------

cert_days_left() { # cert_days_left DOMAIN: whole days until the certificate expires (empty when unknown)
  local expiry end
  expiry=$(echo | openssl s_client -servername "$1" -connect "$1:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')
  [ -n "$expiry" ] || return 0
  end=$(date -d "$expiry" +%s 2>/dev/null) || return 0
  printf '%d' $(((end - $(date +%s)) / 86400))
}

psql_rows() { "${compose[@]}" exec -T postgres psql -U docoo_admin -d docoo -tA -F'|' -c "$1" 2>/dev/null; }

collect() {
  local domain version latest services code days providers admin backup list
  domain=$(env_value DOMAIN)

  version=$(env_value DOCOO_VERSION)
  latest=$(latest_release 2>/dev/null)
  record_from "Release" "$(judge_version "$version" "$latest")"

  if services=$("${compose[@]}" ps --format '{{.Service}}|{{.State}}|{{.Health}}' 2>/dev/null) && [ -n "$services" ]; then
    record_from "Containers" "$(judge_services "$services" "$(env_value BACKUP_S3_PREFIX)")"
  else
    record UNKNOWN "Containers" "docker compose ps gave nothing; run this as root on the server"
  fi

  if "${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/v1/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; then
    record PASS "API ready" "/v1/health/ready answers OK (database and Temporal reachable)"
  else
    record FAIL "API ready" "/v1/health/ready does not answer OK"
  fi

  if [ -n "$domain" ]; then
    # DOCOO_ACCEPTANCE_CURL_OPTS=-k lets the Deploy smoke check a stack whose certificate is local.
    # shellcheck disable=SC2086
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 ${DOCOO_ACCEPTANCE_CURL_OPTS:-} "https://$domain/" 2>/dev/null)
    days=$(cert_days_left "$domain")
    record_from "HTTPS ($domain)" "$(judge_https "$code" "$days")"
  else
    record UNKNOWN "HTTPS" "DOMAIN is not set in deploy/.env"
  fi

  record_from "Disk" "$(judge_disk "$(docker_free_gb 2>/dev/null)")"

  admin=$(psql_rows "select count(*) from memberships m join users u on u.id = m.user_id where m.role = 'super_admin' and u.status = 'active'")
  record_from "Administrator" "$(judge_admin "$admin")"

  providers=$(psql_rows "select provider::text, status::text, count(*) from provider_connections where disabled_at is null group by 1, 2 order by 1, 2")
  record_from "AI connection" "$(judge_providers "$providers")"

  backup=$(env_value BACKUP_S3_PREFIX)
  list=""
  [ -n "$backup" ] && list=$("${compose[@]}" exec -T backup wal-g backup-list 2>/dev/null)
  record_from "Backups" "$(judge_backup "$backup" "$list")"

  record_from "Nightly update" "$(judge_auto_update "$(env_value AUTO_UPDATE)" "$(systemctl is-active docoo-update.timer 2>/dev/null)")"

  local smtp=no
  [ -f "$deploy/.env.production" ] && [ -n "$(sed -n 's/^SMTP_URL=//p' "$deploy/.env.production" | tail -1)" ] && smtp=yes
  record_from "Mail" "$(judge_mail "$smtp")"
}

record_from() { # record_from NAME "STATUS|evidence"
  record "${2%%|*}" "$1" "${2#*|}"
}

report() {
  local domain; domain=$(env_value DOMAIN)
  local pass=0 warn=0 fail=0 action=0 unknown=0 row status
  for row in "${results[@]}"; do
    status=${row%%|*}
    case "$status" in
      PASS) pass=$((pass + 1)) ;; WARN) warn=$((warn + 1)) ;; FAIL) fail=$((fail + 1)) ;;
      ACTION) action=$((action + 1)) ;; *) unknown=$((unknown + 1)) ;;
    esac
  done
  printf '# Docoo private beta: acceptance evidence\n\n'
  printf -- '- Server: %s\n- Release: %s\n- Report time (UTC): %s\n\n' \
    "${domain:-unknown}" "$(env_value DOCOO_VERSION)" "$(date -u +%FT%TZ)"
  printf '| Item | Status | Evidence |\n| --- | --- | --- |\n'
  for row in "${results[@]}"; do
    IFS='|' read -r status name evidence <<<"$row"
    evidence=${evidence//|/\\|} # a pipe inside the evidence must not open a new column
    printf '| %s | %s | %s |\n' "$name" "$status" "$evidence"
  done
  printf '\n%s passed, %s warning(s), %s for the owner, %s failed, %s unknown.\n' "$pass" "$warn" "$action" "$fail" "$unknown"
  cat <<'TAIL'

## What only the owner can confirm

- [ ] GitHub: `pnpm owner:check` shows branch protection and CodeQL (SEC-001, #89).
- [ ] A real AI provider passed the acceptance workflow with its repository secret (AI-002..004).
- [ ] Speech-to-text passed on the acceptance corpus with `TRANSCRIPTION_API_KEY` (ING-005, #53).
- [ ] A backup was restored on another machine at least once (runbook section 8).
- [ ] The beta users and the channel for reporting problems are decided.

## Sign-off (REL-002, #94)

Owner: ______________________   Date: ____________   Decision: accept / not yet
TAIL
  [ "$fail" -eq 0 ]
}

main() {
  [ "$(id -u)" -eq 0 ] || { printf 'Run with sudo (as root).\n' >&2; exit 1; }
  collect
  report
}

# Sourcing the file (the shell tests do) defines the functions without running anything.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
  exit $?
fi
