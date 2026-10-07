# PostgreSQL 18 + pgvector with WAL-G for continuous WAL archiving and point-in-time
# recovery (NFR-REL-004: RPO 15 minutes). Archiving is active once WALG_S3_PREFIX is set.
FROM pgvector/pgvector:0.8.1-pg18@sha256:508c5290cda481d4f5f846446a26e9c1b804766828a394a5861de1b348a18b4c
ARG WALG_VERSION=v3.0.8
ARG WALG_SHA256=b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9
ADD https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-amd64.tar.gz /tmp/wal-g.tar.gz
RUN echo "${WALG_SHA256}  /tmp/wal-g.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/wal-g.tar.gz -C /tmp \
 && install -m 0755 /tmp/wal-g-pg-22.04-amd64 /usr/local/bin/wal-g \
 && rm -f /tmp/wal-g.tar.gz /tmp/wal-g-pg-22.04-amd64 \
 && wal-g --version
COPY archive-wal.sh /usr/local/bin/archive-wal
COPY backup-loop.sh /usr/local/bin/backup-loop
COPY 001-create-runtime-role.sh /docker-entrypoint-initdb.d/001-create-runtime-role.sh
RUN chmod 0755 /usr/local/bin/archive-wal /usr/local/bin/backup-loop
# The official entrypoint supports starting as the postgres user directly (no root needed).
RUN mkdir -p /heartbeat && chown postgres:postgres /heartbeat
USER postgres
