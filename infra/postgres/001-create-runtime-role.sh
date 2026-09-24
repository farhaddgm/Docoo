#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_RUNTIME_USER:?POSTGRES_RUNTIME_USER is required}"
: "${POSTGRES_RUNTIME_PASSWORD:?POSTGRES_RUNTIME_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=runtime_user="$POSTGRES_RUNTIME_USER" \
  --set=runtime_password="$POSTGRES_RUNTIME_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT PASSWORD %L',
  :'runtime_user',
  :'runtime_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user') \gexec

SELECT 'CREATE ROLE docoo_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'docoo_app') \gexec
GRANT docoo_app TO :"runtime_user";
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_user') \gexec
SQL
