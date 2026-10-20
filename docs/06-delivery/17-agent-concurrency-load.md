# Agent concurrency acceptance — partial, 2026-10-16

The provider connection now has a shared model-invocation limit, default4 and configurable1–100 through audited/versioned API edits and the Persian/English providers page. The limit is per connection across API and worker replicas, not a vendor-wide requests/token-per-minute quota. Lowering it allows already running requests to finish.

Admission uses short tenant-scoped transactions and nonblocking advisory locks; queue waits and provider HTTP hold no database clients. Waiting is bounded at60seconds with a retryable capacity error before dispatch/ledger insertion. Leases expire at the explicit provider HTTP timeout plus60seconds, recover after a crashed process, and are released after success/error/cancellation. A release error is retried locally and logged without exception content; it cannot turn a recorded, charged success into another invocation. Migration0048 is additive and is applied by the release update; the feature is not deployed until 0.32.0 is released and installed.

The deterministic CI acceptance creates975background projects and25measured projects via the authenticated API, then activates25actual Temporal workflows simultaneously. Two OS worker processes use separate restricted PostgreSQL pools and the actual production workflow/activity/runtime code. Each reaches its first question batch without human answers or approvals. The provider is deliberately fake and delayed120ms to exercise capacity contention.

| Measurement                                            |              Observed | Target / interpretation                                             |
| ------------------------------------------------------ | --------------------: | ------------------------------------------------------------------- |
| Total projects                                         |                  1000 | NFR-PERF-003 baseline volume                                        |
| Concurrent actual Temporal workflows / analysis rounds |                25 /25 | All have distinct executions and successful scoped ledger rows      |
| Worker processes / independent pools                   |                  2 /2 | 11 and14rounds handled                                              |
| Configured / peak observed provider calls              |                  2 /2 | Shared limit enforced; no leftover leases                           |
| Read API handler p95                                   | 17.479525ms,21samples | <500ms server-handler target; not browser/network latency           |
| Activation handler p95                                 |          288.060248ms | Measured; includes Temporal dispatch                                |
| First question batch p95                               |            2318.790ms | <60000ms deterministic fixture target; includes fake provider delay |
| Entire measured workload                               |         2996.564878ms | Excludes test setup/build/browser launch                            |

After rebasing onto signed v0.27.6, the selected provider-capacity, workflow and trace/load regressions passed all19tests across4files, including the additional cleanup/cancellation boundary cases. All60 build/typecheck/lint tasks,32 unit-test/build tasks, repository formatting, traceability, document manifest, Notion dry-run and actual release-note extraction checks passed. Integration cases also cover25provider calls across two single-client pools, client availability during HTTP/queue waits, cancellation identity, queue timeout/no fictitious usage, expiry/provider failure recovery, range/ETag/authorization/RLS/composite-tenant constraints, cleanup failure after a recorded success and cancellation during admission commit.

Actual Chromium155 acceptance of the capacity UI passed in6.8seconds against a private CI-only API: default4, saved2in Persian and3in English, persisted after reload, native refusal of0without changing stored values, and no serious accessibility violations. This is not a production browser measurement.

Run the actual workflow test with `DATABASE_TEST_ADMIN_URL` pointing to a disposable PostgreSQL18database named `docoo_ci` and `TEMPORAL_ADDRESS` pointing to an isolated Temporal server, after migration/build: `pnpm --filter @docoo/api exec vitest run test/agent-capacity-load.integration.test.ts`. The child worker rejects a privileged runtime role, a non-CI database and any paid adapter.

NFR-PERF-004 is now backed by the actual two-process scaling test, connection-setting integration tests and FA/EN UI acceptance; its waiver is retired. NFR-PERF-003 remains waived until real-provider and deployed page timing are established.

Issue149 remains open: the requested25-workflow configured real-provider run, actual browser-page timing and signed deployed acceptance are not established here. Provider latency/rate limits must be reported separately from service latency. Human quality calibration and reference approval remain#138/#139; no synthetic response or test approval satisfies those gates. The existing parallel Chromium/Firefox/WebKit CI does not certify two historical versions of native Safari.
