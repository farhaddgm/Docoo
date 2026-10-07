# Security hardening operations (v0.23)

The production Compose project is `docoo`; local development defaults to `docoo-dev`. Never use the production project name for a development stack on the same Docker host. Preserve `docoo_postgres-data` when upgrading; the development PostgreSQL volume is a different database.

## Upgrade and configuration

For the first upgrade from v0.22, fetch the reviewed v0.23 release, verify `security-gate.json` against its exact commit with `scripts/deploy/verify-release.py`, then run the **new** installer. The old installer does not generate the new private files. Take a private database backup and preserve deployment configuration first.

`prepare-secrets.mjs deploy` reads the private `.env` and `.env.production` sources, preserves installer settings, generates stable worker passwords and internal tokens once, and writes mode-600 `.env.api`, `.env.web`, `.env.worker-agent`, `.env.worker-ingestion` and `.env.document-renderer`. Compose loads these files in raw mode to preserve JSON and dollar signs. The API alone also loads `.env.google`. Edit source files, then regenerate service files; do not paste credentials into GitHub or the chat.

Workers use separate non-superuser logins. Migration 0040 prevents those logins from reading or changing user credentials, session digests and reset-token digests, even after `SET ROLE docoo_app`. The agent retains the encryption key because calling configured AI providers requires it. The ingestion worker retains object-store credentials because it reads source files. Neither worker receives session or Google secrets. This is a reduction of access, not complete table-by-table separation of all application privileges.

Only Caddy joins the external edge network. Data services use internal networks; PDF rendering has a separate internal network shared only with the API. Only processes requiring external services get an egress network. The renderer has no database, object-store, session, Google or master-key credentials. Chromium's JavaScript and requests are disabled; its `--no-sandbox` process runs within the restricted non-root container. Container restrictions do not replace the Chromium sandbox.

Redis, Temporal, the scanner and the object-backup tool also run as non-root users. The installer adjusts ownership of only the existing Docoo Temporal and signature volumes before starting those images. PostgreSQL and object-backup share UID 999 for the heartbeat volume.

Application containers enforce resource limits and read-only roots with bounded temporary storage. The renderer accepts one job at a time and returns 429 while busy. Increase limits only after measuring actual workloads and available host resources. Readiness, rather than liveness, controls API health during deployment.

## Independent monitoring and mail

After the service upgrade passes readiness and the authenticated monitor endpoint has been checked, set repository variable `SECURITY_MONITOR_ENABLED=true` to enable scheduled checks. Manual dispatch remains available for setup and delivery tests. This avoids reporting an unconfigured rollout as a production incident.

Set the repository secret `SECURITY_MONITOR_TOKEN` to the value generated in the private application source, using secure stdin. The service-monitor workflow checks the public HTTPS readiness route and an authenticated endpoint. It creates or updates one issue assigned to the repository owner for outages, repeated failed logins, account-access changes and overdue **configured** backups, and closes it on recovery. Only opaque codes and timestamps are published. The repository is public; identities, audit records and document content must never be included.

The workflow runs every five minutes on a best-effort GitHub schedule; delays are possible. The last successful monitoring run provides an external checkpoint. Access changes since that checkpoint are checked on recovery (up to 31 days); login failures cover at least fifteen minutes. A failed endpoint does not advance the checkpoint. This is not a guaranteed incident-delivery service or an independent archive of the complete audit trail. GitHub notification delivery also depends on the owner's notification settings. Inspect Actions execution after configuration. Manually dispatch `service-monitor.yml` with `delivery_test=true` to create, assign and close a clearly labelled notification test issue; normal live readiness and security checks still run. Failure detection is also covered by injected offline/not-ready responses in the monitoring tests.

The owner sees whether SMTP is configured. Without SMTP, automatic recovery emails and email notifications are unavailable; use the documented operator reset-link command. Adding SMTP requires a real provider, approved sender and a delivery test. Never claim email is active merely because the UI or outbox exists. Off-host backup configuration is a separate prerequisite; monitoring does not create a backup destination.

## Master-key rotation

Use a private backup and an operator session. The rotation tool requires an administrative database URL; never grant `docoo_key_rotation` or administrative credentials to an application service.

1. Preserve the current key and its ID securely. Generate a new random 32-byte key and a unique ID.
2. In the private application source, set `SECRET_MASTER_KEY` and `SECRET_MASTER_KEY_ID` to the new values, and `SECRET_PREVIOUS_MASTER_KEYS` to a JSON object mapping the previous ID to its base64 key. At most five previous keys are accepted. Use single quotes around the JSON in the source environment file.
3. Regenerate service files and restart the API and agent worker with the new code and key ring. Existing encrypted credentials remain readable through the previous key.
4. Run `node scripts/rotate-master-key.mjs` inside the new API image with a private `DATABASE_ADMIN_URL` supplied through a protected environment file. This is a dry run. It authenticates every stored provider and Contenter credential, prints only counts and changes no records.
5. Run the same command with `--apply`. A transaction and advisory lock protect the operation. Only wrapping fields change; ciphertext and history remain intact. A successful apply records an account-security event.
6. Verify all stored credentials decrypt and no rows reference retired IDs. Remove previous keys from active environments only after verification and after all old application processes have stopped. Retain protected historical keys for the retention period of backups that require them.

Never roll back to code that understands only the old key after rewrapping data with the new key. Rollback requires compatible key-ring code, reversing the rewrap under operator control, or restoring the matching database and keys. A schema-only rollback is insufficient. The database integration gate tests dry run, rewrap, decryption after retiring the old key, worker isolation and prevention of ciphertext mutation.

## Release trust

PR checks cover quality, CodeQL/SAST, dependency and container scans, hardening and real direct/edge installations. Actions and infrastructure image references are pinned; Dependabot proposes updates. Main requires a pull request and successful checks, including for administrators; a single-owner repository does not require impossible self-approval.

The release workflow waits for CI, Security, Hardening and Deploy smoke on the exact main commit and publishes their run IDs in `security-gate.json`. Automatic updates verify those successful GitHub runs before checking out the tag. This evidence relies on GitHub HTTPS/API and repository permissions; it is not a cryptographic artifact signature. An explicit operator `DOCOO_UPDATE_REF` bypasses release lookup for installation tests and deliberate recovery only.
