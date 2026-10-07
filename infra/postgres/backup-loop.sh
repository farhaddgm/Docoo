#!/bin/sh
# Full base backup every BACKUP_INTERVAL_HOURS (default 24) plus retention; together with the
# archived WAL this allows restoring to any second inside the retention window.
set -eu
if [ -z "${WALG_S3_PREFIX:-}" ]; then
  echo "backup: WALG_S3_PREFIX is not set; off-host backups are disabled." >&2
  exec sleep infinity
fi
interval=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
retain=${BACKUP_RETAIN_FULL:-7}
until pg_isready -q; do sleep 2; done
while true; do
  started=$(date +%s)
  if wal-g backup-push "$PGDATA"; then
    wal-g delete retain FULL "$retain" --confirm || true
    echo "{\"event\":\"backup.completed\",\"seconds\":$(( $(date +%s) - started )),\"at\":$(date +%s)}"
    date +%s > /tmp/last-backup-success
    date +%s > /heartbeat/database-success
  else
    echo '{"event":"backup.failed"}' >&2
  fi
  sleep "$interval"
done
