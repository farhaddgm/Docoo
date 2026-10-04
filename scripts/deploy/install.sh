#!/usr/bin/env bash
# Docoo installer for one Ubuntu/Debian server (docs/06-delivery/11-production-install.md).
#
#   sudo ./scripts/deploy/install.sh            # first install: asks a few questions
#   sudo ./scripts/deploy/install.sh update     # pull the latest release and restart
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

[ "$(id -u)" -eq 0 ] || fail "Run with sudo (as root)."

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

# Whole GiB available on the filesystem that holds Docker's data (empty if unknown).
free_gb() {
  local dir
  dir=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  df -Pk "${dir:-/var/lib/docker}" 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1048576 }'
}

# A full disk stops PostgreSQL (the site goes down) and breaks the build half-way, so stop
# *before* anything running is touched. Build cache unused for a week is dropped first; images,
# containers and volumes are never removed here.
require_free_gb() { # require_free_gb GiB "what needs the room"
  local need=$1 free
  free=$(free_gb)
  [ -n "$free" ] || return 0
  if [ "$free" -lt "$need" ]; then
    say "Only ${free} GiB free for Docker; removing build cache older than 7 days…"
    docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
    free=$(free_gb)
  fi
  [ "$free" -ge "$need" ] || fail "Only ${free} GiB free for Docker; $2 needs ${need} GiB. Free some space (docs/06-delivery/11-production-install.md, section 8) and run this again. The running site was not touched. DOCOO_MIN_FREE_GB changes the limit."
}

# Every update leaves the previous release's images and a pile of build cache behind.
tidy() {
  local ref repo
  for ref in $("${compose[@]}" config --images 2>/dev/null | sort -u); do
    repo=${ref%%:*}
    case $repo in docoo-*) ;; *) continue ;; esac
    # Images still used by a container are refused by docker, so nothing running is removed.
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" | grep -vxF "$ref" \
      | xargs -r docker rmi >/dev/null 2>&1 || true
  done
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
}

start() {
  local min=${DOCOO_MIN_FREE_GB:-5}
  require_free_gb "$min" "building the images"
  say "Building and starting Docoo (the first time takes 10–20 minutes)…"
  "${compose[@]}" build
  # Recreating the services needs room for PostgreSQL and the new containers.
  require_free_gb $((min < 2 ? min : 2)) "restarting the services"
  "${compose[@]}" up -d
  for _ in $(seq 1 120); do
    [ "$("${compose[@]}" ps --format '{{.Health}}' api 2>/dev/null)" = healthy ] && return
    sleep 5
  done
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

update() {
  say "Updating to the latest release…"
  git -C "$root" fetch --tags --quiet
  local latest
  # DOCOO_UPDATE_REF pins another commit (used by the Deploy smoke test of a pull request).
  latest=${DOCOO_UPDATE_REF:-$(git -C "$root" tag --list 'v*' --sort=-v:refname | head -1)}
  [ -n "$latest" ] && git -C "$root" checkout --quiet "$latest"
  sed -i "s/^DOCOO_VERSION=.*/DOCOO_VERSION=${latest:-local}/" "$deploy/.env"
  set -a; . "$deploy/.env"; set +a
  use_edge
  start
  attach_edge
  tidy
  say "Docoo is now on ${latest:-the current checkout}."
}

if [ "${1:-install}" = update ]; then
  install_docker
  detect_edge
  update
  exit 0
fi

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
say "Docoo is running at https://$DOMAIN"
if [ -n "$ADMIN_LINK" ]; then
  printf 'Open this link once to choose your password (valid 24 hours):\n%s\n' "$ADMIN_LINK"
  printf 'برای انتخاب گذرواژه این پیوند را یک بار باز کنید (۲۴ ساعت اعتبار دارد).\n'
fi
[ -n "${BACKUP_S3_PREFIX:-}" ] || printf '\nWarning: off-host backups are not configured yet (BACKUP_S3_* in deploy/.env).\n'
