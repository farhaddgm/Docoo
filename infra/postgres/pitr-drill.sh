#!/usr/bin/env bash
# Point-in-time recovery drill (REL-001, NFR-REL-004). Starts a primary with WAL archiving to
# S3, takes a base backup, writes rows before and after a target time, then restores a fresh
# server to exactly that time and checks that only the earlier rows exist. Prints RPO/RTO.
#
# Needs: docker, the image from infra/postgres (IMAGE) and an S3 bucket (S3_* variables).
set -euo pipefail

IMAGE=${IMAGE:-docoo-postgres:local}
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
run=$(date +%s)-$RANDOM
prefix="s3://${S3_BUCKET}/pitr-drill/${run}"
primary=pitr-primary-$run
restored=pitr-restored-$run
walg_env=(-e "WALG_S3_PREFIX=$prefix" -e "AWS_ENDPOINT=$S3_ENDPOINT" -e "AWS_REGION=${S3_REGION:-us-east-1}"
  -e "AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID" -e "AWS_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY"
  -e "AWS_S3_FORCE_PATH_STYLE=true" -e "PGHOST=/var/run/postgresql" -e "PGUSER=postgres")
cleanup() { docker rm -f "$primary" "$restored" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_in() { docker exec -u postgres "$1" psql -qtA -d drill -c "$2"; }
# The image first runs a temporary server for init scripts; wait until the real one is up.
wait_ready() {
  for _ in $(seq 1 120); do
    if docker logs "$1" 2>&1 | grep -q 'PostgreSQL init process complete' &&
      docker exec "$1" pg_isready -q -d drill 2>/dev/null; then return 0; fi
    sleep 1
  done
  docker logs "$1" | tail -30
  return 1
}

docker run -d --name "$primary" --network host "${walg_env[@]}" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill \
  -e POSTGRES_RUNTIME_USER=docoo_runtime -e POSTGRES_RUNTIME_PASSWORD=drill -e PGPORT=55440 \
  "$IMAGE" -c port=55440 -c wal_level=replica -c archive_mode=on -c 'archive_command=archive-wal %p' -c archive_timeout=60 >/dev/null
wait_ready "$primary"
psql_in "$primary" "create table ledger (id int primary key, note text); insert into ledger values (1, 'before backup');"
docker exec -u postgres "$primary" wal-g backup-push /var/lib/postgresql/18/docker >/dev/null 2>&1
psql_in "$primary" "insert into ledger values (2, 'after backup, before target');"
target=$(psql_in "$primary" "select now()")
sleep 2
psql_in "$primary" "insert into ledger values (3, 'after target');"
psql_in "$primary" "select pg_switch_wal()" >/dev/null
for _ in $(seq 1 60); do
  [ "$(psql_in "$primary" "select coalesce(last_archived_wal, '') <> '' and failed_count = 0 from pg_stat_archiver")" = t ] && break
  sleep 1
done
docker rm -f "$primary" >/dev/null

started=$(date +%s)
docker run -d --name "$restored" --network host "${walg_env[@]}" -e PGPORT=55441 --entrypoint sleep "$IMAGE" infinity >/dev/null
docker exec -u postgres "$restored" sh -c "
  set -e
  export PGDATA=/var/lib/postgresql/18/docker
  rm -rf \$PGDATA && mkdir -p \$PGDATA && chmod 700 \$PGDATA
  wal-g backup-fetch \$PGDATA LATEST
  cat >> \$PGDATA/postgresql.auto.conf <<CONF
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '$target'
recovery_target_action = 'promote'
port = 55441
archive_mode = off
CONF
  touch \$PGDATA/recovery.signal
  pg_ctl -D \$PGDATA -w -t 120 -l /tmp/restore.log start
" >/dev/null
for _ in $(seq 1 120); do
  [ "$(docker exec -u postgres "$restored" psql -qtA -p 55441 -d drill -c 'select pg_is_in_recovery()' 2>/dev/null)" = f ] && break
  sleep 1
done
rows=$(docker exec -u postgres "$restored" psql -qtA -p 55441 -d drill -c "select string_agg(id::text, ',' order by id) from ledger")
rto=$(( $(date +%s) - started ))
echo "{\"event\":\"pitr_drill\",\"target\":\"$target\",\"restoredRows\":\"$rows\",\"rtoSeconds\":$rto}"
if [ "$rows" != "1,2" ]; then
  echo "PITR drill FAILED: expected rows 1,2 at the target time, got '$rows'" >&2
  docker exec "$restored" cat /tmp/restore.log | tail -30 >&2 || true
  exit 1
fi
echo "PITR drill passed: restored to $target with rows $rows in ${rto}s (target RTO 4h, RPO bounded by archive_timeout=60s)."
