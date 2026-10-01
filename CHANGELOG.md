# Changelog

All notable changes to Docoo are recorded here. Versions follow [SemVer](https://semver.org/) and are published as `vX.Y.Z` tags with a matching GitHub Release.

## [0.2.1] — 2026-10-01

### Fixed

- Notion sync: requests time out after 30 seconds; network errors are retried for reads and deletes, and a failed write marks only that document as failed.
- Notion sync: progress is logged per document and `notion-state.json` is saved after each one, so an interrupted run resumes instead of starting over.
- Notion sync workflow time limit raised from 45 to 120 minutes for the first full publish.

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

[0.2.1]: https://github.com/farhaddgm/Docoo/releases/tag/v0.2.1
[0.2.0]: https://github.com/farhaddgm/Docoo/releases/tag/v0.2.0
[0.1.0]: https://github.com/farhaddgm/Docoo/commit/e7cebc9dd478c86ed31d0e83d495965621b31bf9
