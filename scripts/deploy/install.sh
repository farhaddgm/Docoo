#!/usr/bin/env bash
# Docoo installer for one Ubuntu/Debian server (docs/06-delivery/11-production-install.md).
#
#   sudo ./scripts/deploy/install.sh            # first install: asks a few questions
#   sudo ./scripts/deploy/install.sh update     # pull the latest release and restart, now
#   sudo ./scripts/deploy/install.sh auto-update on|off|status
#                                               # the nightly update (on by default)
#
# A systemd timer runs `update --scheduled` every night: it installs a newer release when one
# exists, does nothing otherwise, and goes back to the previous release if the new one does
# not become healthy. Manual `update` keeps working and always runs.
#
# Unattended: set DOCOO_UNATTENDED=1 and DOMAIN, ACME_EMAIL, ADMIN_EMAIL (+ optional values
# below) in the environment. Secrets are generated once into deploy/.env and
# deploy/.env.production (mode 600) and are never overwritten.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
deploy="$root/deploy"
compose=(docker compose --project-directory "$deploy" -f "$deploy/compose.production.yaml")
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

ask() { # ask VAR "question" "default"
  local name=$1 question=$2 default=${3:-} value=${!1:-}
  if [ -z "$value" ] && [ "${DOCOO_UNATTENDED:-0}" != 1 ]; then
    read -r -p "$question${default:+ [$default]}: " value
  fi
  printf -v "$name" '%s' "${value:-$default}"
}
secret() { openssl rand -base64 "${1:-32}" | tr -d '\n'; }
alnum() { openssl rand -hex "${1:-24}"; }

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return; fi
  say "Installing Docker…"
  apt-get update -y && apt-get install -y ca-certificates curl openssl
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
}

# Ports 80/443: free → Docoo's Caddy takes them and gets the certificates itself. Held by a
# Caddy container the server already runs → Docoo runs behind it (EDGE_PROXY). Held by
# anything else → stop before anything on the server is changed.
detect_edge() {
  [ -f "$deploy/.env" ] && EDGE_PROXY=${EDGE_PROXY:-$(sed -n 's/^EDGE_PROXY=//p' "$deploy/.env")}
  EDGE_PROXY=${EDGE_PROXY:-}
  [ -n "$EDGE_PROXY" ] && return 0
  local holder="" busy=""
  if command -v docker >/dev/null 2>&1; then
    holder=$(docker ps --format '{{.Names}}{{"\t"}}{{.Label "com.docker.compose.project"}}{{"\t"}}{{.Ports}}' |
      awk -F'\t' '$2 != "docoo" && $3 ~ /:(80|443)->/ { print $1; exit }')
  fi
  if [ -n "$holder" ]; then
    if docker exec "$holder" caddy version >/dev/null 2>&1; then
      EDGE_PROXY=$holder
      say "Ports 80/443 belong to the Caddy container '$holder'; Docoo will run behind it."
      return 0
    fi
    fail "Ports 80/443 are used by the container '$holder', which is not Caddy. Send this message to support.
پورت‌های ۸۰ و ۴۴۳ را کانتینر '$holder' گرفته است که Caddy نیست؛ این پیام را برای پشتیبانی بفرستید."
  fi
  command -v ss >/dev/null 2>&1 || return 0
  busy=$(ss -Hltnp 'sport = :80 or sport = :443' | grep -v docker-proxy || true)
  [ -z "$busy" ] && return 0
  printf '%s\n' "$busy"
  fail "Ports 80/443 are already used by another program (shown above). Stop it or move it first.
پورت‌های ۸۰ و ۴۴۳ را برنامهٔ دیگری گرفته است؛ خروجی بالا را برای پشتیبانی بفرستید."
}

set_env() { # set_env KEY VALUE: write one value into deploy/.env
  if grep -q "^$1=" "$deploy/.env"; then
    sed -i "s|^$1=.*|$1=$2|" "$deploy/.env"
  else
    printf '%s=%s\n' "$1" "$2" >>"$deploy/.env"
  fi
}

use_edge() { # Record the edge mode and switch compose to the edge override.
  [ -n "$EDGE_PROXY" ] || return 0
  set_env EDGE_PROXY "$EDGE_PROXY"
  # Two proxies (the existing Caddy, then Docoo's) stand in front of the API.
  set_env TRUST_PROXY_HOPS 2
  compose+=(-f "$deploy/compose.edge.yaml")
}

# Joins the existing Caddy to the docoo network and adds one site block for the two host names
# to its Caddyfile (a backup is kept next to it); the block is validated before the reload.
attach_edge() {
  [ -n "$EDGE_PROXY" ] || return 0
  local c=$EDGE_PROXY config host_file="" dest src added=0 check
  local block
  block=$(printf '# docoo:begin (added by the Docoo installer; delete this block to detach Docoo)\n%s, %s {\n\treverse_proxy docoo-edge:80\n}\n# docoo:end' "$DOMAIN" "$FILES_DOMAIN")
  say "Connecting Docoo to the existing Caddy '$c'…"
  if ! docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$c" | grep -qw docoo_default; then
    docker network connect docoo_default "$c"
  fi
  config=$(docker inspect -f '{{join .Args " "}}' "$c" | grep -o -- '--config [^ ]*' | cut -d' ' -f2 || true)
  config=${config:-/etc/caddy/Caddyfile}
  while IFS=$'\t' read -r dest src; do
    [ -n "$dest" ] || continue
    if [ "$dest" = "$config" ]; then host_file=$src; break; fi
    case "$config" in "$dest"/*) host_file="$src${config#"$dest"}" ;; esac
  done < <(docker inspect -f '{{range .Mounts}}{{.Destination}}{{"\t"}}{{.Source}}{{"\n"}}{{end}}' "$c")
  if [ -z "$host_file" ] || [ ! -f "$host_file" ] || [[ "$config" == *.json ]]; then
    printf '%s\n' "$block"
    fail "Could not find the Caddyfile of '$c' on this server. Add the block above to it and reload it.
Caddyfile کانتینر '$c' پیدا نشد؛ این پیام را برای پشتیبانی بفرستید."
  fi
  if ! grep -q '^# docoo:begin' "$host_file"; then
    cp -p "$host_file" "$host_file.before-docoo"
    # Append (never replace) so a single-file bind mount keeps pointing at the same file.
    printf '\n%s\n' "$block" >>"$host_file"
    added=1
  fi
  if ! check=$(docker exec "$c" caddy validate --config "$config" --adapter caddyfile 2>&1); then
    [ "$added" = 1 ] && cat "$host_file.before-docoo" >"$host_file"
    printf '%s\n' "$check" | tail -5
    fail "The existing Caddy rejected the Docoo block; its Caddyfile was left unchanged."
  fi
  docker exec "$c" caddy reload --config "$config" --adapter caddyfile >/dev/null 2>&1 || docker restart "$c" >/dev/null
  command -v curl >/dev/null 2>&1 || return 0
  for _ in $(seq 1 30); do
    [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://$DOMAIN/fa" || true)" = 200 ] && return 0
    sleep 4
  done
  printf '\nWarning: https://%s did not answer yet; check that its DNS points to this server.\n' "$DOMAIN"
}

configure() {
  if [ -f "$deploy/.env" ] && [ -f "$deploy/.env.production" ]; then
    say "Existing configuration found in deploy/.env; keeping it."
    return
  fi
  say "Docoo setup / راه‌اندازی Docoo"
  ask DOMAIN "Domain for Docoo, e.g. docoo.example.com"
  [ -n "$DOMAIN" ] || fail "A domain is required."
  ask FILES_DOMAIN "Domain for file uploads" "files.$DOMAIN"
  ask ADMIN_EMAIL "Administrator email"
  [ -n "$ADMIN_EMAIL" ] || fail "An administrator email is required."
  # Behind an existing Caddy that proxy holds the certificates; the email is unused then.
  [ -n "$EDGE_PROXY" ] && ACME_EMAIL=${ACME_EMAIL:-$ADMIN_EMAIL}
  ask ACME_EMAIL "Email for the HTTPS certificate (Let's Encrypt)" "$ADMIN_EMAIL"
  ask ADMIN_DISPLAY_NAME "Administrator name" "Admin"
  ask SMTP_URL "SMTP for password mail, e.g. smtps://user:pass@smtp.example.com:465 (empty = later)" ""
  ask MAIL_FROM "Sender address for mail" "Docoo <no-reply@$DOMAIN>"
  ask BACKUP_S3_PREFIX "Off-host backup location, e.g. s3://my-bucket/docoo (empty = no backups yet)" ""
  if [ -n "$BACKUP_S3_PREFIX" ]; then
    ask BACKUP_S3_ENDPOINT "Backup S3 endpoint URL, e.g. https://s3.eu-central-1.amazonaws.com"
    ask BACKUP_S3_REGION "Backup S3 region" "us-east-1"
    ask BACKUP_S3_ACCESS_KEY_ID "Backup S3 access key id"
    ask BACKUP_S3_SECRET_ACCESS_KEY "Backup S3 secret access key"
  fi
  ask TRANSCRIPTION_API_KEY "Speech-to-text API key (OpenAI-compatible; empty = later)" ""

  umask 077
  cat > "$deploy/.env" <<CONF
# Values docker compose substitutes. Generated $(date -u +%FT%TZ); keep this file private.
DOCOO_VERSION=$(git -C "$root" describe --tags --always 2>/dev/null || echo local)
DOMAIN=$DOMAIN
FILES_DOMAIN=$FILES_DOMAIN
ACME_EMAIL=$ACME_EMAIL
POSTGRES_PASSWORD=$(alnum)
POSTGRES_RUNTIME_PASSWORD=$(alnum)
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:-$(alnum)}
BACKUP_S3_PREFIX=${BACKUP_S3_PREFIX:-}
BACKUP_S3_ENDPOINT=${BACKUP_S3_ENDPOINT:-}
BACKUP_S3_REGION=${BACKUP_S3_REGION:-us-east-1}
BACKUP_S3_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID:-}
BACKUP_S3_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY:-}
BACKUP_S3_FORCE_PATH_STYLE=${BACKUP_S3_FORCE_PATH_STYLE:-false}
CONF
  # shellcheck disable=SC1091
  . "$deploy/.env"
  cat > "$deploy/.env.production" <<CONF
# Application secrets. Generated $(date -u +%FT%TZ); keep this file private.
SESSION_PEPPER=$(secret 48)
SECRET_MASTER_KEY=$(secret 32)
ARTIFACT_SIGNING_KEY=$(secret 48)
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
SMTP_URL=${SMTP_URL:-}
MAIL_FROM=$MAIL_FROM
TRANSCRIPTION_API_KEY=${TRANSCRIPTION_API_KEY:-}
CONF
  printf 'ADMIN_EMAIL=%s\nADMIN_DISPLAY_NAME=%s\n' "$ADMIN_EMAIL" "$ADMIN_DISPLAY_NAME" > "$deploy/.admin"
  chmod 600 "$deploy/.env" "$deploy/.env.production" "$deploy/.admin"
}

open_firewall() {
  [ "${DOCOO_SKIP_FIREWALL:-0}" = 1 ] && return
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
    ufw --force enable >/dev/null || true
  fi
}

wait_healthy() { # 0 when the API reports healthy within ten minutes
  for _ in $(seq 1 120); do
    [ "$("${compose[@]}" ps --format '{{.Health}}' api 2>/dev/null)" = healthy ] && return 0
    sleep 5
  done
  return 1
}

start() {
  say "Building and starting Docoo (the first time takes 10–20 minutes)…"
  "${compose[@]}" build
  "${compose[@]}" up -d
  wait_healthy && return
  "${compose[@]}" logs --tail 50 migrate api
  fail "The API did not become healthy; see the logs above."
}

create_admin() {
  [ -f "$deploy/.admin" ] || return 0
  # shellcheck disable=SC1091
  . "$deploy/.admin"
  set -a; . "$deploy/.env"; set +a
  local out
  if out=$("${compose[@]}" run --rm -T \
      -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_DISPLAY_NAME="$ADMIN_DISPLAY_NAME" \
      -e DATABASE_ADMIN_URL="postgresql://docoo_admin:${POSTGRES_PASSWORD}@postgres:5432/docoo" \
      api node scripts/create-super-admin.mjs 2>&1); then
    rm -f "$deploy/.admin"
    ADMIN_LINK=$(printf '%s\n' "$out" | grep -o 'https://[^ ]*reset-password#token=[^ ]*' || true)
  elif printf '%s' "$out" | grep -q 'already exists'; then
    rm -f "$deploy/.admin"
  else
    printf '%s\n' "$out"; fail "Creating the administrator failed."
  fi
}

# ---- disk space ---------------------------------------------------------------------------
# Building the images needs several GB, and every release leaves its images and build cache
# behind. A full disk used to stop an update in the middle of the build (after the checkout
# had already moved to the new release). Now the space is checked first, old images and build
# cache are cleared, and an update that still cannot fit stops before changing anything.
min_free_gb=${DOCOO_MIN_FREE_GB:-10}
exit_no_space=75 # `update` exits with this when nothing was changed for lack of disk space

docker_free_gb() { # whole GB free where Docker keeps its data
  local dir
  dir=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || dir=/var/lib/docker
  [ -d "$dir" ] || dir=/
  df -Pk "$dir" | awk 'NR == 2 { printf "%d", $4 / 1048576 }'
}

# Removes docoo-* images of releases other than the ones named; an image a container still
# uses is refused by Docker and stays.
remove_old_images() { # remove_old_images KEEP_VERSION...
  local image keep
  while read -r image; do
    for keep in "$@"; do [ "${image##*:}" = "$keep" ] && continue 2; done
    docker rmi "$image" >/dev/null 2>&1 || true
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^docoo-' || true)
}

# light: after a good update, drop leftovers (the build cache of the last day stays for a fast
# rollback). deep: before an update that does not fit, drop all build cache.
tidy_docker() { # tidy_docker light|deep KEEP_VERSION...
  local mode=$1
  shift
  docker image prune -f >/dev/null 2>&1 || true
  remove_old_images "$@"
  if [ "$mode" = deep ]; then
    docker builder prune -f >/dev/null 2>&1 || true
  else
    docker builder prune -f --filter until=24h >/dev/null 2>&1 || true
  fi
  return 0
}

ensure_disk_space() { # ensure_disk_space RUNNING_VERSION: 0 when an update fits
  local free
  free=$(docker_free_gb)
  # Unknown free space is not a reason to refuse the update.
  [ -z "$free" ] || [ "$free" -ge "$min_free_gb" ] && return 0
  say "Only ${free} GB free for Docker (an update needs about ${min_free_gb} GB); clearing old images and build cache…"
  tidy_docker deep "$@"
  free=$(docker_free_gb)
  [ -z "$free" ] || [ "$free" -ge "$min_free_gb" ] && return 0
  printf '\n\033[31mError: only %s GB are free where Docker keeps its data; an update needs about %s GB.\033[0m\n' "$free" "$min_free_gb" >&2
  printf 'Nothing was changed and Docoo keeps running. Free some disk space (or enlarge the disk), then run:\n  sudo %s/scripts/deploy/install.sh update\n' "$root" >&2
  printf 'فضای خالی دیسک برای به‌روزرسانی کافی نیست (%s گیگابایت خالی، حدود %s لازم است). چیزی تغییر نکرد و Docoo همچنان کار می‌کند؛ فضا باز کنید و دوباره اجرا کنید.\n' "$free" "$min_free_gb" >&2
  return 1
}

update() {
  say "Updating to the latest release…"
  git -C "$root" fetch --tags --quiet
  local latest running
  # DOCOO_UPDATE_REF pins another commit (used by the Deploy smoke test of a pull request).
  latest=${DOCOO_UPDATE_REF:-$(latest_release)}
  running=$(env_value DOCOO_VERSION)
  ensure_disk_space "$running" || exit "$exit_no_space"
  [ -n "$latest" ] && git -C "$root" checkout --quiet "$latest"
  sed -i "s/^DOCOO_VERSION=.*/DOCOO_VERSION=${latest:-local}/" "$deploy/.env"
  set -a; . "$deploy/.env"; set +a
  use_edge
  start
  attach_edge
  tidy_docker light "${latest:-local}" "$running"
  say "Docoo is now on ${latest:-the current checkout}."
}

# ---- nightly update ----------------------------------------------------------------------

units=${DOCOO_SYSTEMD_DIR:-/etc/systemd/system}
lock=/run/docoo-update.lock
release_tag='^v[0-9]+\.[0-9]+\.[0-9]+$'

env_value() { # env_value KEY: the value in deploy/.env (empty when missing)
  [ -f "$deploy/.env" ] || return 0
  sed -n "s/^$1=//p" "$deploy/.env" | tail -1
}

latest_release() { git -C "$root" tag --list 'v*' --sort=-v:refname | head -1; }
fetch_releases() { git -C "$root" fetch --tags --quiet; }

has_systemd() { command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; }

render_unit() { sed "s|@ROOT@|$root|g" "$deploy/systemd/$1"; }

install_auto_update() {
  if ! has_systemd; then
    printf 'systemd was not found, so Docoo will not update itself. Update with: sudo %s/scripts/deploy/install.sh update\n' "$root"
    return 0
  fi
  local unit
  for unit in docoo-update.service docoo-update.timer; do
    render_unit "$unit" >"$units/$unit"
    # The installer runs with umask 077 to keep .env private; units hold no secrets and are
    # world-readable like every other unit (systemctl cat works without sudo).
    chmod 644 "$units/$unit"
  done
  systemctl daemon-reload
  systemctl enable --now docoo-update.timer >/dev/null
}

remove_auto_update() {
  has_systemd || return 0
  systemctl disable --now docoo-update.timer >/dev/null 2>&1 || true
}

auto_update_on() { [ "$(env_value AUTO_UPDATE)" != off ]; }

announce_auto_update() {
  auto_update_on || return 0
  has_systemd || return 0
  printf 'Docoo checks for a new release every night (about 03:30) and updates itself. Turn it off: sudo %s/scripts/deploy/install.sh auto-update off\n' "$root"
  printf 'Docoo هر شب (حدود ساعت ۰۳:۳۰) نسخهٔ تازه را بررسی و خودکار نصب می‌کند. خاموش‌کردن: sudo %s/scripts/deploy/install.sh auto-update off\n' "$root"
}

auto_update_command() {
  case "${1:-status}" in
    on)
      set_env AUTO_UPDATE on
      install_auto_update
      say "Automatic nightly updates are on. / به‌روزرسانی شبانه روشن شد."
      ;;
    off)
      set_env AUTO_UPDATE off
      remove_auto_update
      say "Automatic nightly updates are off; update by hand with: sudo $root/scripts/deploy/install.sh update
به‌روزرسانی شبانه خاموش شد."
      ;;
    status)
      local setting
      setting=$(env_value AUTO_UPDATE)
      printf 'Setting:    AUTO_UPDATE=%s\n' "${setting:-on (default)}"
      printf 'Version:    %s\n' "$(env_value DOCOO_VERSION)"
      if has_systemd; then
        printf 'Timer:      %s\n' "$(systemctl is-enabled docoo-update.timer 2>&1 || true)"
        systemctl list-timers docoo-update.timer --no-pager 2>/dev/null | sed -n '1,2p' || true
      else
        printf 'Timer:      systemd not available\n'
      fi
      ;;
    *) fail "Use: install.sh auto-update on|off|status" ;;
  esac
}

# What the nightly run should do: off | no-release | up-to-date | newer-than-release | update.
# A server that runs a release newer than the newest tag is never moved back; a server on any
# other checkout (the first install is a clone of main) is brought onto the newest release.
scheduled_plan() { # scheduled_plan AUTO CURRENT LATEST
  local auto=$1 current=$2 latest=$3
  if [ "$auto" = off ]; then echo off; return; fi
  if [ -z "$latest" ]; then echo no-release; return; fi
  if [ "$current" = "$latest" ]; then echo up-to-date; return; fi
  if [[ $current =~ $release_tag ]] &&
    [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -1)" = "$current" ]; then
    echo newer-than-release
    return
  fi
  echo update
}

take_lock_now() { exec 9>"$lock"; flock -n 9; }
take_lock_wait() { exec 9>"$lock"; flock -w 1800 9; }

run_update_child() { DOCOO_UPDATE_LOCKED=1 "$root/scripts/deploy/install.sh" update; }

# Puts the previous release back. Migrations only add, so the old code runs on the new schema
# (runbook §9); the data is not touched.
rollback() { # rollback VERSION
  local previous=$1
  if [ -z "$previous" ] || [ "$previous" = local ]; then return 1; fi
  git -C "$root" checkout --quiet "$previous" || return 1
  set_env DOCOO_VERSION "$previous"
  set -a; . "$deploy/.env"; set +a
  detect_edge
  use_edge
  "${compose[@]}" build && "${compose[@]}" up -d && wait_healthy
}

scheduled_update() {
  if ! take_lock_now; then
    say "Another update is running; skipping tonight's check."
    return 0
  fi
  local current latest plan
  current=$(env_value DOCOO_VERSION)
  if ! fetch_releases; then
    say "Could not reach GitHub; staying on ${current:-the current version}. Trying again tomorrow."
    return 0
  fi
  latest=${DOCOO_UPDATE_REF:-$(latest_release)}
  plan=$(scheduled_plan "$(env_value AUTO_UPDATE)" "$current" "$latest")
  case "$plan" in
    update) ;;
    off) say "Automatic updates are off; nothing to do."; return 0 ;;
    no-release) say "No release was found; nothing to do."; return 0 ;;
    up-to-date) say "Already on the latest release ($current); nothing to do."; return 0 ;;
    newer-than-release) say "Running $current, which is newer than the latest release ($latest); nothing to do."; return 0 ;;
  esac
  say "New release $latest found (running ${current:-unknown}); updating."
  local status=0
  run_update_child || status=$?
  if [ "$status" = 0 ]; then
    say "Updated to $latest."
    return 0
  fi
  if [ "$status" = "$exit_no_space" ]; then
    # The update stopped before changing anything, so there is nothing to go back from.
    say "Not enough free disk space to update to $latest; nothing was changed and Docoo keeps running ${current:-the current version}. Free some disk space; tomorrow night tries again."
    return 1
  fi
  say "The update to $latest failed; going back to ${current:-the previous release}."
  if rollback "$current"; then
    say "Back on $current and healthy. Look at the log above, then update by hand when the cause is fixed."
  else
    say "Going back did not work either. Run by hand: sudo $root/scripts/deploy/install.sh update"
  fi
  return 1
}

# ---- entry points -------------------------------------------------------------------------

install_main() {
  install_docker
  detect_edge
  configure
  set -a; . "$deploy/.env"; set +a
  use_edge
  open_firewall
  start
  attach_edge
  ADMIN_LINK=""
  create_admin
  install_auto_update
  say "Docoo is running at https://$DOMAIN"
  if [ -n "$ADMIN_LINK" ]; then
    printf 'Open this link once to choose your password (valid 24 hours):\n%s\n' "$ADMIN_LINK"
    printf 'برای انتخاب گذرواژه این پیوند را یک بار باز کنید (۲۴ ساعت اعتبار دارد).\n'
  fi
  announce_auto_update
}

main() {
  [ "$(id -u)" -eq 0 ] || fail "Run with sudo (as root)."
  case "${1:-install}" in
    update)
      if [ "${2:-}" = --scheduled ]; then
        scheduled_update
        return
      fi
      # A manual update waits for a running one; the scheduled child already holds the lock.
      if [ -z "${DOCOO_UPDATE_LOCKED:-}" ]; then
        take_lock_wait || fail "Another update is still running."
      fi
      install_docker
      detect_edge
      update
      # Servers installed before the nightly update existed get the timer with their next update.
      if auto_update_on; then
        install_auto_update
        announce_auto_update
      fi
      ;;
    auto-update) auto_update_command "${2:-status}" ;;
    install) install_main ;;
    *) fail "Use: install.sh [update | auto-update on|off|status]" ;;
  esac
}

# Sourcing the file (the shell tests do) defines the functions without running anything.
# The `exit` matters: an update replaces this very file while it runs, and bash must not go on
# reading the new contents after `main` returns.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
  exit "$?"
fi
