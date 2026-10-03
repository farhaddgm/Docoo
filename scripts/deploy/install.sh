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

configure() {
  if [ -f "$deploy/.env" ] && [ -f "$deploy/.env.production" ]; then
    say "Existing configuration found in deploy/.env; keeping it."
    return
  fi
  say "Docoo setup / راه‌اندازی Docoo"
  ask DOMAIN "Domain for Docoo, e.g. docoo.example.com"
  [ -n "$DOMAIN" ] || fail "A domain is required."
  ask FILES_DOMAIN "Domain for file uploads" "files.$DOMAIN"
  ask ACME_EMAIL "Email for the HTTPS certificate (Let's Encrypt)"
  ask ADMIN_EMAIL "Administrator email" "$ACME_EMAIL"
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

start() {
  say "Building and starting Docoo (the first time takes 10–20 minutes)…"
  "${compose[@]}" build
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
  latest=$(git -C "$root" tag --list 'v*' --sort=-v:refname | head -1)
  [ -n "$latest" ] && git -C "$root" checkout --quiet "$latest"
  sed -i "s/^DOCOO_VERSION=.*/DOCOO_VERSION=${latest:-local}/" "$deploy/.env"
  start
  say "Docoo is now on ${latest:-the current checkout}."
}

if [ "${1:-install}" = update ]; then
  install_docker
  update
  exit 0
fi

install_docker
configure
open_firewall
start
ADMIN_LINK=""
create_admin
set -a; . "$deploy/.env"; set +a
say "Docoo is running at https://$DOMAIN"
if [ -n "$ADMIN_LINK" ]; then
  printf 'Open this link once to choose your password (valid 24 hours):\n%s\n' "$ADMIN_LINK"
  printf 'برای انتخاب گذرواژه این پیوند را یک بار باز کنید (۲۴ ساعت اعتبار دارد).\n'
fi
[ -n "${BACKUP_S3_PREFIX:-}" ] || printf '\nWarning: off-host backups are not configured yet (BACKUP_S3_* in deploy/.env).\n'
