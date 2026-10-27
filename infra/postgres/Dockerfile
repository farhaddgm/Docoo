# WAL-G v3.0.9 from verified source, with patched gRPC and a current Go runtime.
FROM golang:1.27.3-bookworm@sha256:972b4110ba0f47539a975c31e52c64765e1ff19f2d74469ae4a595c6676e80a5 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY="https://proxy.golang.org|direct" GOFLAGS=-mod=mod GOMAXPROCS=2 GOEXPERIMENT=jsonv2
ADD --checksum=sha256:011fd76c0b0e0558bf5daa34d25973f13a500843e9ab1134c8ea396db5df613f https://codeload.github.com/wal-g/wal-g/tar.gz/3e493188db28335fb93a45bd680c6ff8fc3028c1 /tmp/source.tgz
WORKDIR /source
RUN tar -xzf /tmp/source.tgz --strip-components=1 -C /source && rm /tmp/source.tgz
RUN go get google.golang.org/grpc@v1.84.0 golang.org/x/net@v0.60.0 && go build -p 2 -trimpath -buildvcs=false \
    -ldflags '-s -w -X github.com/wal-g/wal-g/cmd/pg.walgVersion=v3.0.9 -X github.com/wal-g/wal-g/cmd/pg.gitRevision=3e493188db28335fb93a45bd680c6ff8fc3028c1' \
    -o /out/wal-g ./main/pg

# PostgreSQL 18 + pgvector with WAL-G for continuous WAL archiving and point-in-time
# recovery (NFR-REL-004: RPO 15 minutes). Archiving is active once WALG_S3_PREFIX is set.
FROM pgvector/pgvector:0.8.7-pg18@sha256:2358fcba361ed2233a5ed81b5fe4ca779ccb304120ce531a3bf51c0ed7e2bc11
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* /usr/local/bin/gosu
COPY --from=builder /out/wal-g /usr/local/bin/wal-g
RUN wal-g --version
COPY archive-wal.sh /usr/local/bin/archive-wal
COPY backup-loop.sh /usr/local/bin/backup-loop
COPY 001-create-runtime-role.sh /docker-entrypoint-initdb.d/001-create-runtime-role.sh
RUN chmod 0755 /usr/local/bin/archive-wal /usr/local/bin/backup-loop
# The official entrypoint supports starting as the postgres user directly (no root needed).
RUN mkdir -p /heartbeat && chown postgres:postgres /heartbeat
USER postgres
