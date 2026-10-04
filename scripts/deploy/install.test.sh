#!/usr/bin/env bash
# Tests of the nightly-update logic in install.sh without Docker, git or systemd: the decisions
# (scheduled_plan), the unit files, the on/off switch and the order of steps in
# scheduled_update (skip, update, roll back) with the side effects replaced by recorders.
#
#   bash scripts/deploy/install.test.sh
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/install.sh"
set +e # the tests check results themselves; install.sh turned errexit on

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

bash -n "$here/install.sh" || { echo 'FAIL install.sh has a syntax error'; exit 1; }

# ---- scheduled_plan ----------------------------------------------------------------------
assert_eq off "$(scheduled_plan off v0.10.0 v0.10.1)" 'plan: switched off wins'
assert_eq no-release "$(scheduled_plan on v0.10.0 '')" 'plan: no tag yet'
assert_eq up-to-date "$(scheduled_plan on v0.10.1 v0.10.1)" 'plan: same release'
assert_eq update "$(scheduled_plan on v0.10.0 v0.10.1)" 'plan: newer patch'
assert_eq update "$(scheduled_plan on v0.9.2 v0.10.0)" 'plan: 0.10 sorts after 0.9'
assert_eq newer-than-release "$(scheduled_plan on v0.11.0 v0.10.1)" 'plan: never move back'
assert_eq update "$(scheduled_plan on v0.10.0-3-gebf904c v0.10.0)" 'plan: a clone of main moves onto the release'
assert_eq update "$(scheduled_plan on ebf904c v0.10.0)" 'plan: a bare commit moves onto the release'
assert_eq update "$(scheduled_plan '' v0.10.0 v0.10.1)" 'plan: unset setting means on'

# ---- unit files --------------------------------------------------------------------------
root=/opt/docoo
deploy="$here/../../deploy"
service=$(render_unit docoo-update.service)
timer=$(render_unit docoo-update.timer)
assert_contains "$service" 'ExecStart=/opt/docoo/scripts/deploy/install.sh update --scheduled' 'service runs the scheduled update'
assert_contains "$service" 'Type=oneshot' 'service is one-shot'
case "$service$timer" in *@ROOT@*) assert_eq none present 'no placeholder is left' ;; *) assert_eq none none 'no placeholder is left' ;; esac
assert_contains "$timer" 'OnCalendar=*-*-* 03:30:00' 'timer runs at night'
assert_contains "$timer" 'Persistent=true' 'timer catches up after downtime'
assert_contains "$timer" 'WantedBy=timers.target' 'timer is installable'

# ---- on / off switch ---------------------------------------------------------------------
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
deploy="$work/deploy"
units="$work/units"
mkdir -p "$deploy/systemd" "$units"
cp "$here/../../deploy/systemd/"* "$deploy/systemd/"
printf 'DOCOO_VERSION=v0.10.0\nDOMAIN=localhost\n' >"$deploy/.env"
calls=()
has_systemd() { return 0; }
systemctl() { calls+=("systemctl $*"); }
say() { :; }

umask 077 # the installer runs like this while it writes .env; the units must not inherit it
auto_update_command on
umask 022
assert_eq on "$(env_value AUTO_UPDATE)" 'on is stored'
assert_eq yes "$([ -f "$units/docoo-update.timer" ] && [ -f "$units/docoo-update.service" ] && echo yes)" 'on writes both units'
assert_eq 644 "$(stat -c %a "$units/docoo-update.service")" 'service unit is world-readable under umask 077'
assert_eq 644 "$(stat -c %a "$units/docoo-update.timer")" 'timer unit is world-readable under umask 077'
assert_contains "${calls[*]}" 'systemctl enable --now docoo-update.timer' 'on enables the timer'
auto_update_command off
assert_eq off "$(env_value AUTO_UPDATE)" 'off is stored (replaces the value)'
assert_eq 1 "$(grep -c '^AUTO_UPDATE=' "$deploy/.env")" 'the setting is written once'
assert_contains "${calls[*]}" 'systemctl disable --now docoo-update.timer' 'off disables the timer'
assert_eq v0.10.0 "$(env_value DOCOO_VERSION)" 'other settings stay'
if auto_update_on; then assert_eq off on 'auto_update_on after off'; else assert_eq off off 'auto_update_on after off'; fi

# systemd missing: nothing is written and the owner is told how to update by hand
has_systemd() { return 1; }
rm -f "$units"/*
out=$(install_auto_update)
assert_contains "$out" 'will not update itself' 'no systemd: says so'
assert_eq 0 "$(find "$units" -type f | wc -l | tr -d ' ')" 'no systemd: writes nothing'
has_systemd() { return 0; }

# ---- scheduled_update --------------------------------------------------------------------
reset() { steps=(); lock_busy=0; fetch_ok=1; child_ok=1; rollback_ok=1; setting=on; installed=v0.10.0; newest=v0.10.1; }
take_lock_now() { [ "$lock_busy" = 0 ]; }
fetch_releases() { steps+=(fetch); [ "$fetch_ok" = 1 ]; }
latest_release() { echo "$newest"; }
env_value() { case "$1" in AUTO_UPDATE) echo "$setting" ;; DOCOO_VERSION) echo "$installed" ;; esac; }
run_update_child() { steps+=(update); [ "$child_ok" = 1 ]; }
rollback() { steps+=("rollback:$1"); [ "$rollback_ok" = 1 ]; }

reset; scheduled_update; status=$?
assert_eq 0 "$status" 'new release: succeeds'
assert_eq 'fetch update' "${steps[*]}" 'new release: updates and does not roll back'

reset; installed=v0.10.1; scheduled_update; status=$?
assert_eq 0 "$status" 'up to date: succeeds'
assert_eq fetch "${steps[*]}" 'up to date: no restart, no rebuild'

reset; setting=off; scheduled_update; status=$?
assert_eq 0 "$status" 'switched off: succeeds'
assert_eq fetch "${steps[*]}" 'switched off: nothing is updated'

reset; installed=v0.11.0; scheduled_update; status=$?
assert_eq 0 "$status" 'newer than the release: succeeds'
assert_eq fetch "${steps[*]}" 'newer than the release: never goes back'

reset; lock_busy=1; scheduled_update; status=$?
assert_eq 0 "$status" 'another update running: succeeds'
assert_eq '' "${steps[*]}" 'another update running: does not even fetch'

reset; fetch_ok=0; scheduled_update; status=$?
assert_eq 0 "$status" 'GitHub unreachable: succeeds (tries again tomorrow)'
assert_eq fetch "${steps[*]}" 'GitHub unreachable: keeps the running version'

reset; child_ok=0; scheduled_update; status=$?
assert_eq 1 "$status" 'failed update: reports failure'
assert_eq 'fetch update rollback:v0.10.0' "${steps[*]}" 'failed update: goes back to the version it ran'

reset; child_ok=0; rollback_ok=0; scheduled_update; status=$?
assert_eq 1 "$status" 'failed update and rollback: reports failure'

printf '%s checks, %s failed\n' "$checks" "$failures"
[ "$failures" = 0 ]
