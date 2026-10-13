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
reset() { steps=(); lock_busy=0; fetch_ok=1; child_rc=0; rollback_ok=1; setting=on; installed=v0.10.0; newest=v0.10.1; }
take_lock_now() { [ "$lock_busy" = 0 ]; }
fetch_releases() { steps+=(fetch); [ "$fetch_ok" = 1 ]; }
latest_release() { echo "$newest"; }
env_value() { case "$1" in AUTO_UPDATE) echo "$setting" ;; DOCOO_VERSION) echo "$installed" ;; esac; }
run_update_child() { steps+=(update); return "$child_rc"; }
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

reset; child_rc=1; scheduled_update; status=$?
assert_eq 1 "$status" 'failed update: reports failure'
assert_eq 'fetch update rollback:v0.10.0' "${steps[*]}" 'failed update: goes back to the version it ran'

reset; child_rc=1; rollback_ok=0; scheduled_update; status=$?
assert_eq 1 "$status" 'failed update and rollback: reports failure'

log=$(mktemp)
say() { printf '%s\n' "$*" >>"$log"; }
reset; child_rc=$exit_no_space; scheduled_update; status=$?
assert_eq 1 "$status" 'no disk space: reports failure'
assert_eq 'fetch update' "${steps[*]}" 'no disk space: nothing was changed, so no rollback'
assert_contains "$(cat "$log")" 'Not enough free disk space' 'no disk space: says why'
rm -f "$log"
say() { :; }

# ---- disk space --------------------------------------------------------------------------
docker() { # a recorder for the Docker commands the tidy-up runs
  case "$1" in
    info) echo /tmp ;;
    ps) printf '%s\n' running-container stopped-container ;;
    inspect) printf '%s\n' sha256:running-image sha256:stopped-image ;;
    images) printf '%s\n' docoo-api:v0.12.0 docoo-api:v0.11.0 docoo-api:v0.10.0 docoo-web:v0.9.0 docoo-postgres:local docoo-api:v0.8.0 docoo-web:v0.8.0 docoo-issues-deploy-helper:20261013 other-app:v0.9.0 ;;
    rmi) removed+=("$2") ;;
    image)
      if [ "$2" = inspect ]; then
        case "${@: -1}" in
          docoo-api:v0.8.0) echo sha256:running-image ;;
          docoo-web:v0.8.0) echo sha256:stopped-image ;;
          *) echo "sha256:${@: -1}" ;;
        esac
      else cleared+=("$*"); fi ;;
    builder) cleared+=("$*") ;;
  esac
}
removed=(); cleared=()
remove_old_images v0.12.0 v0.11.0
assert_eq 'docoo-api:v0.10.0 docoo-web:v0.9.0' "${removed[*]}" 'old images: other releases go, the two kept stay, other apps are never touched'
removed=(); remove_old_images local
assert_eq 'docoo-api:v0.12.0 docoo-api:v0.11.0 docoo-api:v0.10.0 docoo-web:v0.9.0' "${removed[*]}" 'old images: a clone of main keeps its local images'

removed=(); cleared=(); tidy_docker light v0.12.0 v0.11.0
assert_eq '' "${cleared[*]}" 'tidy light: no global image or builder prune'
removed=(); cleared=(); tidy_docker deep v0.11.0
assert_eq '' "${cleared[*]}" 'tidy deep: no global image or builder prune'

assert_eq 1 "$(docker_free_gb | grep -Ec '^[0-9]+$')" 'free space: a whole number of GB'

queue=$(mktemp); log=$(mktemp); tidied=0
# One free-space reading per call, popped from a file because the callers run it in $( ).
docker_free_gb() { head -1 "$queue"; sed -i 1d "$queue"; }
tidy_docker() { tidied=$((tidied + 1)); }
assert_eq 24 "$min_free_gb" 'default build capacity protects full infrastructure builds'
assert_eq 5 "$build_reserve_gb" 'remaining build reserve'
min_free_gb=10
readings() { printf '%s\n' "$@" >"$queue"; }
readings 25; tidied=0; ensure_disk_space v0.11.0 >/dev/null; status=$?
assert_eq 0 "$status" 'enough space: update goes on'
assert_eq 0 "$tidied" 'enough space: nothing is cleared first'
readings 3 14; tidied=0; ensure_disk_space v0.11.0 >/dev/null; status=$?
assert_eq 0 "$status" 'low space that tidying fixes: update goes on'
assert_eq 1 "$tidied" 'low space: clears old images and cache once'
readings 3 4; tidied=0; ensure_disk_space v0.11.0 >"$log" 2>&1; status=$?
assert_eq 1 "$status" 'still too little space: refuses'
assert_contains "$(cat "$log")" 'only 4 GB are free' 'still too little space: says how much is free'
assert_contains "$(cat "$log")" 'Nothing was changed' 'still too little space: says nothing changed'
readings ''; tidied=0; ensure_disk_space v0.11.0 >/dev/null; status=$?
assert_eq 1 "$status" 'unknown capacity refuses the build'
assert_eq 0 "$tidied" 'unknown capacity performs no cleanup'
# Serial service calls remain bounded even when Compose delegates to Bake; duplicate image
# targets (migrate/API) and services without a build are omitted.
compose=(docker compose)
docker() {
  if [ "$2" = config ]; then
    printf '%s\n' '{"services":{"api":{"build":{},"image":"docoo-api:v1"},"migrate":{"build":{},"image":"docoo-api:v1"},"web":{"build":{},"image":"docoo-web:v1"},"redis":{"image":"redis:7"}}}'
  elif [ "$2" = build ]; then
    assert_eq 3 "$#" 'one build target per call'
    builds+=("$3")
  fi
}
builds=(); readings 20 15; build_images; status=$?
assert_eq 0 "$status" 'serial builds succeed with capacity'
assert_eq 'api web' "${builds[*]}" 'serial build order and shared image deduplication'
builds=(); readings 5 4; build_images >"$log" 2>&1; status=$?
assert_eq 75 "$status" 'remaining reserve stops before next build'
assert_eq 'api' "${builds[*]}" 'no second build started below reserve'
builds=(); readings ''; build_images >"$log" 2>&1; status=$?
assert_eq 75 "$status" 'unknown reserve stops builds'
assert_eq '' "${builds[*]}" 'no build started with unknown reserve'

# Initial install shares the updater lock and refuses before configuration/firewall changes.
steps=()
take_lock_wait() { steps+=(lock); }
install_docker() { steps+=(docker); }
ensure_disk_space() { steps+=(disk); return 1; }
configure() { steps+=(configure); }
install_main >"$log" 2>&1; status=$?
assert_eq 75 "$status" 'initial install refuses low space'
assert_eq 'lock docker disk' "${steps[*]}" 'lock and capacity before configuration'
# Manual update failure restores actual files and source metadata; a failed build does not
# recreate any container. Only the Docker/Git network side effects are replaced.
fixture=$(mktemp -d); deploy="$fixture/deploy"; root="$fixture"; mkdir -p "$deploy"
printf 'previous-commit\n' > "$fixture/head"
printf 'DOCOO_VERSION=v0.11.0\n' > "$deploy/.env"
printf 'TEST_SECRET=original-fixture-secret\n' > "$deploy/.env.production"
chmod 600 "$deploy/.env" "$deploy/.env.production"
git() {
  case "$3" in
    fetch|diff) return 0 ;;
    rev-parse) cat "$fixture/head" ;;
    checkout) printf '%s\n' "${@: -1}" > "$fixture/head" ;;
  esac
}
env_value() { sed -n "s/^$1=//p" "$deploy/.env"; }
ensure_disk_space() { return 0; }
use_edge() { return 0; }
attach_edge() { steps+=(attach); }
tidy_docker() { steps+=(tidy); }
rollback() { steps+=("rollback:$1"); }
DOCOO_UPDATE_REF=v0.12.0
start() {
  printf 'TEST_SECRET=changed-fixture-secret\n' > "$deploy/.env.production"
  printf 'generated\n' > "$deploy/.env.web"
  return 19
}
steps=(); update >"$log" 2>&1; status=$?
assert_eq 19 "$status" 'manual build failure is returned'
assert_eq v0.11.0 "$(env_value DOCOO_VERSION)" 'manual failure restores recorded version'
assert_eq previous-commit "$(cat "$fixture/head")" 'manual failure restores exact checkout'
assert_eq TEST_SECRET=original-fixture-secret "$(cat "$deploy/.env.production")" 'manual failure restores private source'
assert_eq 600 "$(stat -c %a "$deploy/.env.production")" 'private file mode retained'
assert_eq 1 "$([ ! -e "$deploy/.env.web" ] && echo 1 || echo 0)" 'new derived env removed on failure'
assert_eq '' "${steps[*]}" 'failed build leaves old containers alone'
assert_eq update "$(scheduled_plan on "$(env_value DOCOO_VERSION)" v0.12.0)" 'nightly check retries failed manual update'
start() { touch "$DOCOO_UPDATE_BACKUP_DIR/up-attempted"; return 9; }
steps=(); update >"$log" 2>&1; status=$?
assert_eq 9 "$status" 'failed startup is returned'
assert_eq rollback:v0.11.0 "${steps[*]}" 'failed startup restores retained old runtime'
assert_eq v0.11.0 "$(env_value DOCOO_VERSION)" 'failed startup restores recorded version'
start() { return 0; }
steps=(); update >"$log" 2>&1; status=$?
assert_eq 0 "$status" 'manual update commits on success'
assert_eq v0.12.0 "$(env_value DOCOO_VERSION)" 'successful startup commits recorded version'
assert_eq v0.12.0 "$(cat "$fixture/head")" 'successful startup keeps new source'
assert_eq 'attach tidy' "${steps[*]}" 'successful update attaches edge and cleans only after startup'
rm -rf "$fixture"
# A caller using `if start` disables Bash errexit within functions: explicit error propagation
# must still prevent up/chown after a build failure.
eval "$(sed -n '/^start() {/,/^}/p' "$here/install.sh")"
env_value() { echo v0.11.0; }
ensure_disk_space() { return 0; }
build_images() { return 19; }
helper_runs=0; up_calls=0
docker() {
  if [ "$1" = run ]; then helper_runs=$((helper_runs+1)); fi
  if [ "$1" = compose ] && [ "$2" = up ]; then up_calls=$((up_calls+1)); fi
  return 0
}
if start >"$log" 2>&1; then status=0; else status=$?; fi
assert_eq 19 "$status" 'conditional start propagates failed build'
assert_eq 1 "$helper_runs" 'failed build never reaches volume ownership changes'
assert_eq 0 "$up_calls" 'failed build never reaches compose up'
rm -f "$queue" "$log"

printf '%s checks, %s failed\n' "$checks" "$failures"
[ "$failures" = 0 ]
