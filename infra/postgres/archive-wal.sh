#!/bin/sh
# archive_command: ships each finished WAL segment to off-host storage with WAL-G.
# Without WALG_S3_PREFIX nothing is archived (PITR off) and PostgreSQL recycles the segment.
if [ -z "${WALG_S3_PREFIX:-}" ]; then
  exit 0
fi
exec wal-g wal-push "$1"
