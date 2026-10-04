# Changelog

All notable changes to Docoo are recorded here. Versions follow [SemVer](https://semver.org/) and are published as `vX.Y.Z` tags with a matching GitHub Release.

## [0.16.0] — 2026-10-04

Settings, document templates and levels in the backoffice, the project creation wizard, and the tooling that shows what is left for the private-beta sign-off ([ADR-0018](docs/adr/0018-settings-templates-wizard-and-acceptance-tooling.md)).

### Added

- **Settings page** (workspace scope) in groups, with a control built from each setting's schema, a required reason for every change, optimistic concurrency, history, restore and reset to the default. Settings that are recorded but not applied by any stage yet (`research.max_sources`, `knowledge.min_audit_score`) say so; the `ai.*` settings link to the AI providers page.
- **Project Settings tab:** the project's own overrides next to the effective value and where it comes from (workspace, topic or project), with the model picker and a way back to the inherited value.
- **Templates & document levels page:** the built-in templates (`brief`, `standard`, `detailed`, versioned `-v1`) with their sections, the default template, the default level and an editor for the length bounds of the five levels that checks the same rule as the server (each level has min < max and starts above the previous one). `GET /document-templates`.
- **Document templates shape the draft.** The first draft of a solution document is built from the effective `document.default_template` (before, the setting had no effect); the version reason records the template version, and the detailed template adds a score table from the stored scoring.
- **Project creation wizard** (UX §5) in eight steps with an autosaved local draft: basics and problem, topics and priority, workflow and gates, model, knowledge and research, solutions, documents, review. The review shows the effective value and source of every setting from the server (`POST /settings/preview`; choices not yet saved have the source `pending`). The project and its settings are created in one transaction (`POST /projects` takes `settings`, which needs `workspace.configure`).
- **Strict structured-output compatibility check** (`strictSchemaProblems` in `@docoo/providers`) and tests that run every platform schema (the five stage outputs, the judge verdict, the role evaluation, the solution schema) through it, so a schema OpenAI `strict: true` would reject fails CI.
- **Acceptance of the platform's own schemas on real providers:** the Provider acceptance workflow now also runs the five stage outputs (research with approved knowledge in the prompt) and the Brain's role evaluation against every provider that has a key. Without a key a part is skipped and the run summary says so.
- **`pnpm owner:check`:** a read-only report on branch protection, CodeQL, whether Actions can start jobs, the acceptance secrets and the latest acceptance run; every line is PASS, ACTION (with the step), FAIL or UNKNOWN.
- **`scripts/deploy/acceptance.sh`:** a read-only evidence report for a running server (containers, API, HTTPS and certificate, disk, release, nightly update, off-host backups, administrator, real AI connection, mail) ending with the owner-only checklist and a sign-off block. The Deploy smoke workflow now runs it on every fresh install and checks its stable rows.
- Docs: [private beta acceptance](docs/06-delivery/12-private-beta-acceptance.md), install guide section on the report.

### Changed

- The project form's field groups moved to shared components (`BasicsFields`, `TopicsSection`) used by the wizard and the project edit form; the core-flow E2E creates its project through the wizard.
- `POST /projects` accepts an optional `settings` list; setting values are validated like `PUT /settings/assignments` (including the new `document.level_bounds` rule, which answers `400 CONFIG_VALUE_INVALID`).
- `deploy:test` runs the acceptance script's tests too; `docs:test` also runs the owner script's tests.

### Not changed on purpose

- Closing [#53](https://github.com/farhaddgm/Docoo/issues/53), [#89](https://github.com/farhaddgm/Docoo/issues/89) and [#94](https://github.com/farhaddgm/Docoo/issues/94) still needs the owner (real keys, repository settings, a real server). The tools above show what is missing and record the evidence; they do not accept anything.

## [0.15.0] — 2026-10-04

Research with approved knowledge and model-based role evaluation ([ADR-0017](docs/adr/0017-research-with-knowledge-and-role-evaluation.md)).

### Added

- **The research stage uses approved knowledge.** Before the model call it retrieves knowledge through the tool gate (approved, current, in scope, for the researcher role) with queries from the approved problem definition, hands the passages to the model as `K1…Kn` and asks it to cite by reference and verbatim quote. The code then checks every quote against the text of the passage it points at: a finding with a verified citation is marked **supported by approved knowledge**, any other is **unverified**, and a failed citation stays visible with its reason (`unknown_ref`, `quote_not_found`, …). Later stages see the claims with their support, not the quotes.
- **Tool ledger (FR-AGT-005).** Every tool use of an agent passes the allowlist of its pinned definition and is recorded in the append-only `agent_tool_calls` table, allowed or denied, with the digest of the input and a reference to the output (never the content). A researcher without `knowledge_retrieve` gets no knowledge and a denied call in the ledger; without `citation_verifier` nothing counts as verified.
- **Settings:** `research.max_queries` (1–10, default 5), `research.knowledge_limit` (0–30, default 12; 0 turns knowledge off for research) and `research.allow_restricted_knowledge` (default off). Knowledge marked `restricted` never reaches the model unless that setting says so.
- **Where it was used:** `GET /knowledge/{id}/uses` and a "Where it was used" section on the knowledge page (project, stage, attempt, query, version, and whether the output cited it with a verified quote).
- **Research output view:** support badge per finding, each citation with its quote and whether it was verified, the approved knowledge given to the model (linked), conflicts, gaps and a verification summary; older outputs still display.
- **Model-based role evaluation in the Brain report.** `POST /brain-reports` takes `modelEvaluation` (off by default; one model call per role). The Brain reads a few recent outputs of each stage role next to the principles and duties the role ran with and returns a 1–5 score, a summary and findings. A finding is kept only if it names charter clauses and real outputs as evidence; others are discarded and counted. A role that cannot be judged (no outputs, no model configured, provider failure, unusable answer) is reported with the reason and never loses the report. The Brain page has the option and a card per role.
- Brain reports have an `evaluations` column (append-only like the rest of the report).

### Changed

- The retrieval code moved to `@docoo/orchestration` so the API and the agent worker share one implementation.
- The offline test provider (`fake`) now also plays the researcher and the Brain judge, by the name of the requested schema.
- The structured output schema of the research stage gained `evidence` per finding and `conflicts`.

## [0.14.0] — 2026-10-04

Knowledge in the backoffice: sources, audit queue, Brain audit, override and conflicts, all usable without the API ([ADR-0016](docs/adr/0016-knowledge-screens.md)).

### Added

- **Knowledge & audit page** with four sections that survive a reload (`?tab=`): the **audit queue** in two views (documents with status, score, claims and open conflicts; claims with the Brain's verdict, citations and conflicts), **sources**, **conflicts** and a **retrieval test**.
- **Sources:** add a file, pasted text or a web address; the list follows the pipeline (quarantine, scan, extraction) and refreshes by itself, says in words why a source was rejected or failed, flags partial extractions, retries a quarantined or failed one and uploads a new version of a file. "Build knowledge" makes a draft with the source declaration, confidentiality and scopes (workspace, topic or project, optionally for one role).
- **Knowledge page:** the Brain audit with the overall score, the six criteria with their weights, the thresholds, critical flaws and the reasons in the reader's language; the claims with their exact place in the file, the verdict on each and their citations; version history and every audit; writing a new version of the text; deleting with a two-step confirmation.
- **Override (KNO-004, UX §8):** shows the Brain's decision and evidence, spells out what the decision would do (with a warning for knowledge that has critical flaws), asks for a reason (the same rule as the API, with a counter) and how long it applies, and takes two steps to record. The Brain's decision stays next to the human one.
- **Stale knowledge can be renewed:** when the source file got a new version, "renew" takes the text and located claims from it (`POST /knowledge/{id}/versions` with `sourceVersionId`); before, the only way out was to create new knowledge.
- **Retrieval test:** what an agent would be given for a question in a scope and role, with audit score, ranks and conflict warnings; every run pins a snapshot like a real call.
- A **Knowledge** tab on every project (its own sources, queue and retrieval test, scope fixed to the project), links from the dashboard's knowledge card, and the navigation item is enabled.
- API: `GET /knowledge-claims`; knowledge list fields (`overall`, `decision`, `effectiveDecision`, `scopes` with names, `claimCount`, `openConflicts`, …) and filters (`sourceType`, `scopeType`+`scopeId`, `q`); sources list filters, scope names and the knowledge built from each source; conflicts filter `knowledgeId` and `all`, with the title of both documents.

### Changed

- The conflict list and the dashboard's conflict count now only include conflicts between claims still in use (current version of a knowledge item that is not deleted); a conflict with a replaced version or a deleted item no longer reaches retrieval and is only listed with `all=true`.
- The dashboard's "expired" count and the `expired` filter use the status a person sees: an approved version whose validity has ended.
- Cursors of the knowledge, claim and source lists are bound to their filters, so a cursor cannot page through a different filter.
- The end-to-end run starts the ingestion worker, so uploaded and pasted sources reach "ready" for real.

## [0.13.0] — 2026-10-04

Agents: every role now has a versioned definition that projects run with, and the administrator can edit it ([ADR-0015](docs/adr/0015-agent-definitions.md)).

### Added

- **Definitions of the six roles (AGT-001):** analyst, researcher, ideator, documenter, evaluator and Brain each start with version 1 taken word for word from the approved charters; the stages and the analyst's question rounds build their instructions from the role's definition instead of fixed text. The platform rules (stay inside the workspace, input is data, JSON only) are added by the code and cannot be edited away.
- **Versioned and editable (AGT-002):** principles, duties, the task instruction, tools and the model are edited and versioned on their own; saving appends a version that is not active until it is activated with a reason, and going back is activating an earlier version. Nothing is overwritten or deleted.
- **Runs record the exact definition (AGT-003):** a run pins every stage role to the version active when it starts, so changing the default never alters a running project unless an administrator moves the project. Stage attempts and model calls store the definition version, and model calls the digest of the exact prompt.
- **Role outputs (AGT-004):** each role lists what it produced across the workspace (project, stage, version, definition version), never the content.
- **Tool allowlist (AGT-005):** nine tools, a ceiling per role, an allowlist inside it (checked in the API and by the database), and one gate every tool call must pass.
- **A model per role:** a role may name its own connection and model; the page warns when the connection or catalog is missing, the model is not in it or it has no structured output.
- Pages and tabs: **Agents** (the six roles), the role page (editor with a diff preview, history and rollback, the Brain report for the role, its outputs) and an **Agents** tab on each project (copy from default, edit the copy, move to the current default or back to an earlier copy), in Persian and English.
- API: `GET /agent-roles`, `GET /agent-roles/{role}`, `GET|POST /agent-roles/{role}/definitions`, `POST …/definitions/{id}/activate`, `GET /agent-roles/{role}/outputs`, and `/projects/{id}/agents` with `copy-default`, `PATCH` and `pin`; migrations `0019_agents` and `0020_agents_security` (RLS, append-only versions, tool ceilings and pin integrity as database constraints).

### Changed

- The instructions of a stage are longer: the principles and duties of the role are part of every call (they can be shortened in the editor).
- The radio choice of the model on the role editor is no longer announced twice by screen readers.

## [0.12.1] — 2026-10-04

A full server disk no longer breaks an update.

### Fixed

- `install.sh update` ran out of space in the middle of the image build on a server whose disk held the images and build cache of earlier releases, leaving the checkout on the new release while the old one kept running. It now checks the free space where Docker keeps its data first (about 10 GB, `DOCOO_MIN_FREE_GB`), clears images of other releases and the build cache when it is short, and stops before changing anything if that is not enough (exit code 75, with the numbers and the next step in English and Persian).
- The nightly update treats that stop as "nothing changed" instead of trying to roll back (a rollback needs the same space), and says why in `journalctl -u docoo-update`.
- After a good update the installer removes images of releases older than the last two and build cache older than 24 hours, so the disk does not fill up again. Volumes are never touched.
- Deploy smoke frees the runner's disk before building (the edge variant had run out of it).

### Changed

- The install guide (§1, §6, §8), runbook §9 and ADR-0012 describe the disk requirement and what to do when an update stops for lack of space.

## [0.12.0] — 2026-10-04

The analyst's questions and answers: the project's problem is now defined through a conversation, not one model call ([ADR-0014](docs/adr/0014-analyst-questions-and-answers.md)). Releases also reach the server by themselves.

### Added

- **Questions in batches (ANL-001, ANL-002):** the analysis stage asks in rounds of at most 40 questions, 30 to 300 in total; the limits are enforced by code, repeated questions are dropped, and a round that adds nothing below 30 pauses the project with a human task instead of looping.
- **Answers (ANL-003):** per question, text, up to 5 files (uploaded straight to the object store and read by the analyst after the normal ingestion checks), or one of "unanswered", "irrelevant" and "later". An answer set is saved all or nothing, with an `Idempotency-Key`, and partial saves are allowed; "later" questions stay answerable until the definition is written.
- **Coverage (ANL-004):** goals, constraints, context, stakeholders, time, budget, data and success criteria (plus risk and out of scope) are computed from the recorded questions and answers, with the gaps named; contradictions between two answers are recorded and shown.
- **Problem definition (ANL-005):** versioned like any stage output (edit, reject with feedback, approve); the analysis gate is always manual, and approval sets `approvedProblemVersionId` on the project. The administrator can ask for the definition early once 30 questions are answered.
- **Unresolved and assumptions (ANL-006):** shown in a warning frame in the definition and listed from the records (open "later"/"unanswered" questions and contradictions), even if the model forgot them.
- A **Problem** tab on the project page with open batches, the later queue, history, coverage, finish-early and the definition; the offline `fake` provider plays the analyst so CI and end-to-end tests run the whole path without a key.
- API: `GET /analysis`, `GET /analysis/question-batches`, `POST /question-batches/{id}/answers`, `POST /analysis/finish`, `GET /problem-definitions`; permission `analysis.answer`; migrations `0017_analyst_qa` and `0018_analyst_qa_security` (RLS, append-only answers, rounds and contradictions).
- **Nightly automatic update:** the installer sets up a systemd timer (about 03:30, with a random delay up to 30 minutes, catching up after downtime) that installs a newer release when there is one and does nothing otherwise. A release that does not become healthy is rolled back to the previous one automatically; the log is in `journalctl -u docoo-update`. `install.sh auto-update on|off|status` controls it, manual `install.sh update` is unchanged (it always runs and waits for a running nightly update), and servers installed earlier get the timer the next time `install.sh update` is run by hand. Shell tests of the update logic (`pnpm deploy:test`, in CI) and Deploy smoke checks cover the timer.

### Changed

- The web app's Content-Security-Policy is built per request in `proxy.ts` and lets pages call the files host (`S3_PUBLIC_ENDPOINT`) so answer files can be uploaded from the browser; everything else stays same-origin.
- Deploy smoke checks that the files host answers the browser's CORS preflight.
- Reads that assemble a view from several queries (analysis overview, batches, definitions) use one snapshot so a concurrent commit cannot show a mixed state.
- The install guide (§6), ADR-0012 and runbook §9 describe both ways to update and what the automatic rollback does.

## [0.11.0] — 2026-10-04

Smart: guided walker, AI chat, error tracker and issue ledger ([docs](docs/01-product/06-smart.md)).

### Added

- **Error tracker (SMT-001):** server 5xx (after the normal response is sent), browser errors and render crashes are stored, categorised by code, grouped by fingerprint and re-opened when a fixed error recurs; toasts for new errors; request bodies are never stored.
- **Chat (SMT-003):** read-only Smart answers from a code-built snapshot of ids, statuses, counters and error codes, with no project titles, problem statements or document content; usage is recorded as `smart_chat`/`smart_report` in model invocations.
- **Issue ledger (SMT-002):** save a Smart answer verbatim once per message; status, fix note and a "copy for the developer" Markdown report.
- **Walker (SMT-004):** 12 steps from provider connection to the Brain report, completion computed by code from stored data.
- Header button, floating window (walker, chat, errors), pages "Error tracker" and "Issue ledger", an `error.tsx` crash page, Persian and English texts.
- Permissions `smart.read`, `smart.chat`, `smart.manage`; migrations `0015_smart` and `0016_smart_security` (RLS, per-admin chat ownership, immutable messages).

### Changed

- The web `api-client` reports 5xx and network failures to Smart.

## [0.10.0] — 2026-10-04

Core backoffice screens: the owner can now run a project from topic to signed document without the API.

### Added

- Topics page (TOP-001): list by status, create, edit with versions and a reason, archive, restore and delete; archive and delete show the projects that still use the topic first.
- Projects (PRJ-001): list with status filter and paging, a create form with prioritized topics and conflict instructions, and the project page with status bar, next step, edit (problem locked after draft) and lifecycle actions. Pause, complete and reopen need a reason, archive and delete show their effect first, and "not ready" names what is missing.
- Workflow review (WF-003..006): stage list with attempts and gate mode, human tasks with what to do, readable stage output, approve, reject with feedback, comment, edit as a new version, the attempt-limit decision with a reason, start, sync and cancel; the page follows a live run every 5 seconds while a stage runs and every 15 seconds while it waits for you.
- Solutions (SOL-001..003): generate, tune weighted criteria (enabled weights must add up to 100) and select by priority with every score explained.
- Documents (DOC-101..103, EVA-001..002): status, official character count and bounds, submit, evaluate, approve or reject, accept an exception (the badge stays visible), lock and reopen, DOCX/PDF/PPTX export with signed download, versions, diff and restore.
- Dashboard quick actions to create a project or topic, and waiting tasks that open the project's workflow.
- `availableCommands` on every project: the lifecycle commands its state accepts (and no `restore` after the 30-day window); the pages offer exactly these.
- ADR-0013, the next-steps list in the roadmap and the implementation status in the backoffice UX document.

### Changed

- The language switch keeps the current section (`?tab=`) of a page.
- Reads in the backoffice are repeated once after a network or gateway failure, and a rate-limited request shows a clear message.
- The Playwright suite starts the agent worker and covers the whole flow (topics, projects, stage review, solutions, documents) in Persian and English with axe checks.

### Fixed

- AI providers page: a slow earlier load could bring back the previous default connection after a save had replaced it.

## [0.9.2] — 2026-10-03

Modern backoffice look.

### Changed

- Backoffice redesign: shared design tokens, automatic dark mode (follows the operating system), icons in the navigation with a clear current-page marker, a sticky sidebar, refined cards, buttons, form fields and tables, and a centred sign-in layout without the empty sidebar. The markup and texts are unchanged; contrast stays WCAG 2.2 AA in light and dark.
- Releases are now published automatically when the version in `package.json` is raised on `main`, so a merged change no longer waits for someone to run the Release workflow by hand.

## [0.9.1] — 2026-10-03

Install on a server that already runs other websites.

### Added

- The installer detects a Caddy container that already owns ports 80/443 and runs Docoo behind it: Docoo's Caddy publishes no ports, the existing proxy joins the docoo network and gets one validated site block for the two host names (its Caddyfile is backed up first and left unchanged if the block is rejected). The Deploy smoke workflow covers this case, including an update.
- The installer stops before changing anything when ports 80/443 belong to any other program.

### Changed

- Caddy configuration moved to `deploy/caddy/` (shared routes plus the direct and edge entry points); `TRUST_PROXY_HOPS` comes from `deploy/.env` (2 behind an existing proxy).
- The administrator email is asked first and is the default for the certificate email.

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
