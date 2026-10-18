# Production trace acceptance — v0.27.4

Observed on 2026-10-15 at 23:31 UTC (2026-10-16 local date), using Chromium 155.0.8059.39 against the public HTTPS application. This is an actual browser click and configured-provider invocation; CI separately exercises the same correlation path with a deterministic provider.

- Signed release: [v0.27.4](https://github.com/farhaddgm/Docoo/releases/tag/v0.27.4), main `82a449efea911b7ee416d203af0362b153b02cb7`.
- Fixes: [PR178](https://github.com/farhaddgm/Docoo/pull/178), [PR180](https://github.com/farhaddgm/Docoo/pull/180).
- Request ID sent and echoed: `cdb8f058-ce9a-41c3-806d-76786b58f367`; actual activation HTTP200. The wizard's first field survived immediate entry and page reload.
- Trace ID: `0899b4246d6c09b1160c973eb8693386`, 72 actual exported spans in private Tempo.
- Exactly one successful `analysis:round` call, configured OpenAI adapter / `gpt-6-luna`, invocation `6654676b-5785-47ea-b910-2a980a57abf8`. A configured price row is present; ledger estimate USD0.001454, not an invoiced amount. The adapter name alone does not establish the endpoint's operator.

| Operation                 | Service            | Span ID            | Parent span ID     |
| ------------------------- | ------------------ | ------------------ | ------------------ |
| instrumentation.operation | docoo-api          | `3a4708ea20ec9c0d` | ``                 |
| workflow.activity         | docoo-worker-agent | `10ca905a30e81382` | `3a4708ea20ec9c0d` |
| provider.invoke           | docoo-worker-agent | `1d2cf67ab4e95b32` | `10ca905a30e81382` |

All three rows have the same trace ID and validated request ID. The provider completion log's invocation ID joins the successful usage ledger row. First-party execution logs always include all ten correlation fields; identifiers unavailable at a stage are null. The following actual provider-completion record replaces workspace and workflow identities with explicit redactions; trace, request, span, invocation, timing and outcome are unchanged.

```json
{
  "timestamp": "2026-10-15T23:31:45.343Z",
  "level": "info",
  "event": "provider.invoke.completed",
  "tenantId": "<redacted-tenantId>",
  "projectId": "<redacted-projectId>",
  "workflowId": "<redacted-workflowId>",
  "runId": "<redacted-runId>",
  "temporalRunId": "<redacted-temporalRunId>",
  "stageRunId": "<redacted-stageRunId>",
  "attemptId": null,
  "requestId": "cdb8f058-ce9a-41c3-806d-76786b58f367",
  "traceId": "0899b4246d6c09b1160c973eb8693386",
  "spanId": "1d2cf67ab4e95b32",
  "service": "provider-runtime",
  "outcome": "succeeded",
  "durationMs": 22645.902204999933,
  "invocationId": "6654676b-5785-47ea-b910-2a980a57abf8"
}
```

The entire exported trace and API/agent/ingestion logs were checked for the private synthetic problem marker and temporary session value; neither appeared. Exported attributes were checked against the allowlist. URLs, SQL, prompt/problem text, arbitrary resources, exception messages and events are removed by the exporter. Collector and Tempo have no published host ports; this document contains no raw prompts, cookies, keys or customer identities. The raw trace SHA256 is `2a4251b9e6155c3d154e9de1803d1c1ce3ad8863bc880459d5747d6da643214f`; private evidence is retained outside the repository.

The QA workflow was cancelled and settled, its dedicated project and topic archived, and both audited temporary sessions revoked. No human review was submitted. The original reference retained its draft version,37 model calls and pending owner gate; native signed DOCX/PPTX acceptance reused existing receipts without another model call. This trace is functional production evidence, not human model-quality calibration or Office visual certification.

Automated evidence: `packages/observability/src/correlation.test.ts`, `activity-correlation.test.ts`, `private-trace-exporter.test.ts`, `apps/api/test/request-correlation.test.ts`, `apps/api/test/trace-correlation.integration.test.ts`, and the compiled tracing-enabled API boot check `scripts/deploy/telemetry-smoke.mjs` in CI. PR180 passed all25 checks; final-main CI38651894023, Security38651893984, Hardening38651894994, Deploy smoke38651894050 and signed Release38651894182 succeeded. All14 deployed image identities passed fresh fixable HIGH/CRITICAL and secret scans before protected installation.
