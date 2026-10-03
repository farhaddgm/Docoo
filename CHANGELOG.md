# Changelog

All notable changes to Docoo are recorded here. Versions follow [SemVer](https://semver.org/) and are published as `vX.Y.Z` tags with a matching GitHub Release.

## [0.9.0] — 2026-10-03

Production install for a non-expert owner, and the owner-blocked items reduced to accounts and keys.

### Added

- One-command production install (`scripts/deploy/install.sh`, `deploy/compose.production.yaml`, ADR-0012): Caddy with automatic HTTPS, all services, migrations, generated secrets kept out of git, firewall, an administrator created without a typed password plus a single-use set-password link, and `install.sh update` for new releases. The Deploy smoke workflow runs it on a clean machine for every pull request.
- Continuous off-host backups: PostgreSQL image with WAL-G (pinned, checksummed), WAL shipped at least every 5 minutes, daily base backups with retention, object mirroring with rclone; `infra/postgres/pitr-drill.sh` proves point-in-time recovery in CI.
- AI providers page: add OpenAI, Gemini or Anthropic keys (encrypted, write-only), check health, refresh models and choose the default connection and model.
- Password-reset mail over SMTP (`SMTP_URL`, `MAIL_FROM`) with a bilingual message; Mailpit inbox for local development.
- Provider acceptance workflow: real OpenAI/Gemini/Anthropic and speech-to-text checks (ING-005 word accuracy on the corpus) that run as soon as the repository secrets exist.
- Free SAST in the Security workflow (Semgrep, pinned open rules), so private repositories without Code Security still get a SAST gate.
- `TRUST_PROXY_HOPS` so rate limits see each real client behind the proxy while spoofed `X-Forwarded-For` stays ignored.

### Fixed

- AES-256-GCM secrets now pin the 16-byte authentication tag; a truncated tag is rejected.
- Database migrations run from the built package (production images), not only through tsx.

## [0.8.0] — 2026-10-03

Phase 6 (hardening and private-beta readiness) complete, except the owner actions listed in the runbook.

### Added

- Security gates (SEC-001): the Security workflow runs on every pull request and push; `pnpm audit`, Trivy filesystem scan (now failing on findings) and a Trivy image scan of every service image; CodeQL stays behind the owner's Code Security decision. Service images are built with `pnpm deploy --prod` and without npm/corepack, so build tools never ship.
- DAST and auth-path penetration test (SEC-002): ZAP baseline of the web app, ZAP API scan with a real session against the administrator's workspace, a gate on high/critical alerts, and `scripts/security/auth-probe.mjs` (enumeration, cookie flags, fixation, tampering, CSRF, CORS, injection, error leakage, brute force and spoofed `X-Forwarded-For`). Web pages now send a Content-Security-Policy.
- SLOs and alerts (SRE-001): stable HTTP metrics, export and audit SLI metrics, Temporal worker metrics (`TEMPORAL_METRICS_ADDRESS`), Prometheus recording and multi-window burn-rate alerts with runbook links and `promtool` unit tests, and the Grafana SLO dashboard.
- Load test (SRE-002): k6 main-path scenario with 25 concurrent administrators over 1,000 projects and SLO thresholds; `ops:load-seed` for the baseline volume.
- Backup and restore (REL-001): `ops:backup-drill` backs up roles, database and objects, restores them into a separate PostgreSQL 18 server and bucket, verifies every table checksum, RLS, append-only triggers, policies, migrations and object hashes, and reports RTO.
- Runbooks and private beta (REL-002): incident process, one runbook per alert, release rollback and the private-beta checklist with owner sign-off.
- The Hardening workflow runs all of the above on every pull request and nightly and keeps the reports as artifacts.
- `API_RATE_LIMIT_PER_MINUTE` (default 120) for single-source load and DAST runs.

## [0.7.0] — 2026-10-03

Phase 5 (dashboard, Brain report and audit explorer) complete.

### Added

- Dashboard (REP-001): `GET /dashboard` and live cards for pending human tasks, workflow states, knowledge pending/expired/needing revision and open conflicts, provider health with cost-ceiling warnings, stages close to their attempt limit, 30-day usage and the latest Brain report, plus quick actions.
- Brain report (REP-002): `POST/GET /brain-reports` with the deterministic `charter-v1` rules; every deviation names the charter clause, role, severity and evidence records and becomes an actionable recommendation; reports are append-only and generating one changes no project, document, setting or task.
- Audit explorer (REP-003): filters (action family, target type, severity, period, security-only), paging and JSON/CSV export in the web app, usable by keyboard in Persian (RTL) and English (LTR).
- Cost report (REP-004): `GET /reports/usage` grouped by project, stage, day or model for a period, with totals, failures and latency; the web page shows it as a table.
- `brain_reports` table with RLS and append-only history (migrations 0013/0014); ADR-0011; 5 routes in the authorization matrix.

### Tests

- 3 API integration tests (live dashboard data, usage groupings, Brain evidence and no side effects), the extended RLS gate, and an end-to-end test of the reporting pages by keyboard in both languages with axe checks.

## [0.6.0] — 2026-10-03

Phase 4 (solutions, documents and evaluation) complete.

### Added

- Solutions (SOL-001..003): 2–20 solutions per run (default `solution.count`) from the configured model with structured output; every solution has a title, summary, assumptions, evidence, an implementation plan, risks and 1–5 score inputs, otherwise nothing is stored; versioned weighted criteria that can be enabled and reweighted (enabled weights add up to 100) with an explanation for every score; ordered selection that creates one document per selected solution.
- Documents (DOC-101..103): `packages/documents` with the structured document model and validator, the official `unicode-letter-number-v1` character count and five length levels (`document.level`, `document.level_bounds`); append-only versions for every edit, restore and supersede with `If-Match`, block-level diff, submit (`non_compliant` outside the level), approve, reject, lock and supersede; a database guard for locked documents; deterministic DOCX and PPTX (management summary with an explicit overflow error) and PDF rendered in Chromium with page numbers and RTL support; HMAC-signed manifests (`ARTIFACT_SIGNING_KEY`) checked again on download and by `verify`.
- Evaluation (EVA-001..002): the nine-criteria system rubric and versioned project rubrics; a model judge with evidence per criterion plus the deterministic format and length validator; `passed`, `failed_quality`, `failed_compliance` and `technical_error` results; findings with severity and target stage that an administrator can retarget with a reason; approval only after a passed evaluation of the same version or a visibly accepted exception.
- 27 API routes in the authorization matrix, 11 RLS-protected tables, ADR-0010, and the API contracts for §9–§10.

### Fixed

- Settings with list values (such as `document.level_bounds`) can now be set through the settings API.

### Tests

- 9 new API integration tests, 14 document package tests, the extended RLS gate, and a real Chromium PDF render in CI.

## [0.5.0] — 2026-10-02

Phase 3 (orchestration and provider runtime) complete.

### Added

- Project workflows (WF-001..006): activation starts a Temporal `projectWorkflow` (`apps/worker-agent`, queue `docoo.agent`) with the fixed stages analysis → research → ideation → documentation → evaluation; manual gates by default (`waiting_for_human`, human tasks, timeline events) or automatic gates; approve, reject with feedback, comment and edit, where an edit creates a new output version and expires the earlier gate and approval; pause at the next safe boundary, resume, cancel that keeps outputs, and `workflow/sync` after an engine outage; attempt limit (at most 10) passed only by a recorded `extend` or `pass` decision with a reason; `Idempotency-Key` receipts so a repeated command has no second side effect; deterministic replay checked in CI.
- Provider runtime (AI-001..005): one contract with OpenAI (Responses, `store=false`), Gemini (`generateContent`) and Anthropic (Messages, forced tool for structured output) adapters plus a deterministic fake; write-only secrets with envelope encryption (`SECRET_MASTER_KEY`) and versioned rotation; sanitised health checks; live model catalog snapshots with no model names in code; the approved retry schedule with `Retry-After`, then pause and a human task, with fallback off; every invocation stores tokens, latency, finish reason and estimated cost from dated price snapshots; project usage per stage against `ai.max_cost_usd_per_run`.
- Settings `ai.connection_id` and `ai.model`; ADR-0009; 13 RLS-protected tables with append-only secret, output, review, invocation and receipt history.
- Tests: provider contract tests against official-shaped mock APIs, 13 new API integration tests (8 on a real Temporal worker in CI), the extended RLS gate and the authorization matrix for 24 new routes.

## [0.4.0] — 2026-10-02

Phase 2 (ingestion and knowledge) complete, except speech-to-text acceptance, which needs a provider key.

### Added

- Sources (ING-001..008): presigned direct upload into quarantine with the size limit from settings and a SHA-256 check; real MIME sniffing that must agree with the declared type and extension; archive-bomb limits; ClamAV `clamd` scan that fails closed; pasted text and URL intake with allowlist policy and SSRF guards; new versions with lineage that mark dependent knowledge stale; claim candidates with their exact location.
- Ingestion worker (`apps/worker-ingestion`): Temporal workflow `ingest-<versionId>` with idempotent scan and extract activities; parsing in a permission-restricted Node sandbox without network; PDF, DOCX, PPTX, XLSX, CSV, TXT, MD and JSON extractors with page, slide, cell and line locators; Tesseract OCR (fa/eng) for scanned pages and images; an OpenAI-compatible speech-to-text adapter.
- Knowledge (KNO-001..007): items with source type, provenance, scopes, confidentiality and versions; Brain audit with the six-criteria rubric v1 behind the `KnowledgeAuditor` contract; overrides that need a reason and raise a critical audit event; conflict detection with warnings on every retrieval; citation completeness; hybrid full-text and pgvector retrieval with append-only, repeatable snapshots.
- Settings `ingestion.max_file_mb`, `ingestion.url_policy` and `ingestion.url_allowlist`; the `malware-scanner` service in `compose.yaml`; ADR-0008.
- CI starts SeaweedFS, `clamd` (EICAR test signature) and Temporal, installs Tesseract, and runs 52 API integration tests, the extended RLS gate and an end-to-end worker test.

### Known limitation

- ING-005 (#53): audio is stored as `partial` until `TRANSCRIPTION_API_KEY` is set; the word-accuracy acceptance on `audio-fa-001` and `audio-en-001` needs that key.

## [0.3.0] — 2026-10-02

Phase 1 (control plane) complete; phase 0 closed with evidence.

### Added

- Authentication (AUTH-001..003): progressive lockout with audit, password change with session rotation, single-use reset tokens (`/auth/password/reset-request`, `/auth/password/reset`, `pnpm admin:reset-link`), `GET /me`, `DELETE /me/sessions`, and a role → permission matrix enforced on every workspace route.
- Topics (TOP-001): read, edit with `If-Match`/`ETag`, full version history, archive, restore, soft delete with dependent-project check and 30-day recovery.
- Projects (PRJ-001): CRUD with prioritized topics, the formal state machine (activate, pause, resume, complete, reopen, archive, unarchive, delete, restore) with expected versions and reasons, 30-day recovery, timeline, and clone without history.
- Versioned configuration (CFG-001): setting definitions, append-only assignments per workspace/topic/project, effective values with sources, history, restore as a new version, and config snapshots pinned at activation and resume.
- Audit explorer (AUD-001): filters by project, action family, target, actor, severity and time; JSON/CSV export that is itself audited; retention purge with audit tombstones.
- Bilingual shell (UX-001): design tokens, skip link, landmarks, focus management, locale switch that keeps the session, locale formatting, and forgot/reset password pages.
- Quality gates (QA-001, QA-002): 31 API integration tests and the extended RLS gate on PostgreSQL 18, Playwright E2E with axe (WCAG 2.2 AA), and acceptance corpus v0 (scanned Persian/English PDFs, Persian/English speech) with `pnpm qa:corpus`.
- Docs: authorization matrix and the story breakdown of the phase 2–6 epics.

### Fixed

- Telemetry (ENG-007): the API exported no traces because OpenTelemetry started after its ESM imports. It now starts from an `--import` entry, so HTTP and PostgreSQL spans are exported without query values.

## [0.2.1] — 2026-10-01

### Fixed

- Notion sync: requests time out after 30 seconds; network errors are retried for reads and deletes, and a failed write marks only that document as failed.
- Notion sync: progress is logged per document and `notion-state.json` is saved after each one, so an interrupted run resumes instead of starting over.
- Notion sync workflow time limit raised from 45 to 120 minutes for the first full publish.

### Documentation

- All 41 manifest documents published to Notion on 2026-10-01; README, readiness checklist and the Notion integration guide record the live state.

## [0.2.0] — 2026-09-30

### Added

- Direct repository → Notion documentation sync (`scripts/notion/`): Markdown to Notion blocks, doc_id-based page matching, checksum idempotency, document index updates and state committed back to `main`.
- `pnpm docs:test` and `pnpm docs:sync:plan`; both run in CI.
- SessionStart hook for Claude Code cloud sessions: Node 24, pnpm 12, Docker daemon and dependencies.
- Release workflow that publishes a GitHub Release from this changelog, on a pushed `vX.Y.Z` tag or a manual run on `main` that creates the tag from `package.json`.

### Changed

- `Notion documentation sync` workflow publishes with the `NOTION_TOKEN` secret instead of an external webhook, and supports a manual `force` run.

### Removed

- `scripts/notion-sync-request.mjs` (webhook request).

### Security

- `next` 16.3.5 → 16.3.6 (GHSA-vcvr-r3jv-pc5j, critical).
- `@grpc/grpc-js` pinned to `>=1.14.5` (GHSA-m9gg-hp2v-232j, high).

## [0.1.0] — 2026-09-24

### Added

- Product, domain, AI, architecture, security and delivery baseline documentation and ADRs 0001–0007.
- Monorepo foundation: NestJS API, Next.js bilingual web shell, workers, Compose stack, CI and security workflows.
- Super Admin authentication, workspace authorization, topic list/create and PostgreSQL RLS.

[0.5.0]: https://github.com/farhaddgm/Docoo/releases/tag/v0.5.0
[0.4.0]: https://github.com/farhaddgm/Docoo/releases/tag/v0.4.0
[0.3.0]: https://github.com/farhaddgm/Docoo/releases/tag/v0.3.0
[0.2.1]: https://github.com/farhaddgm/Docoo/releases/tag/v0.2.1
[0.2.0]: https://github.com/farhaddgm/Docoo/releases/tag/v0.2.0
[0.1.0]: https://github.com/farhaddgm/Docoo/commit/e7cebc9dd478c86ed31d0e83d495965621b31bf9
