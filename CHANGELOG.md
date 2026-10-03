# Changelog

All notable changes to Docoo are recorded here. Versions follow [SemVer](https://semver.org/) and are published as `vX.Y.Z` tags with a matching GitHub Release.

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
