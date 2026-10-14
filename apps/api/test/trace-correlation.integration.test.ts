import { randomUUID } from 'node:crypto';
import { context, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  PrivateTraceExporter,
  correlationKeys,
  correlatedWorkerLogger,
} from '@docoo/observability';
import { Runtime } from '@temporalio/worker';
import { expect, it, vi } from 'vitest';

import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

it.skipIf(!adminUrl || !temporalAddress)(
  'carries an authenticated API request across real Temporal activities to recorded provider spans without content',
  async () => {
    const spans: {
      name: string;
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      attributes: Record<string, unknown>;
    }[] = [];
    const records: Record<string, unknown>[] = [];
    const canary = 'PRIVATE_PROBLEM_PROMPT_SECRET_CANARY';
    const requestId = randomUUID();
    const writer = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      const text = String(chunk);
      try {
        records.push(JSON.parse(text) as Record<string, unknown>);
      } catch {
        /* SDK diagnostic output is not a first-party JSON record. */
      }
      expect(text).not.toContain(canary);
      return true;
    });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      traceExporter: new PrivateTraceExporter({
        export(batch, done) {
          for (const span of batch)
            spans.push({
              name: span.name,
              traceId: span.spanContext().traceId,
              spanId: span.spanContext().spanId,
              ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
              attributes: span.attributes,
            });
          expect(
            JSON.stringify(
              batch.map((span) => ({
                attributes: span.attributes,
                events: span.events,
                status: span.status,
                resource: span.resource.attributes,
              })),
            ),
          ).not.toContain(canary);
          done({ code: 0 });
        },
        async shutdown() {},
      }),
    });
    let h: Harness | undefined;
    let projectId = '';
    let rootSpanId = '';
    let rootTraceId = '';
    sdk.start();
    Runtime.install({
      logger: correlatedWorkerLogger('worker-agent'),
      telemetryOptions: { logging: { forward: {} } },
    });
    try {
      h = await createHarness('trace', { workflow: true, correlation: true });
      Runtime.instance().logger.warn(canary, { prompt: canary });
      const cookie = await h.login(h.emails.a);
      const api = `/v1/workspaces/${h.ids.workspaceA}`;
      const topic = await h.request('POST', `${api}/topics`, {
        cookie,
        payload: { code: 'trace', title: 'Trace fixture' },
      });
      expect(topic.statusCode, topic.body).toBe(201);
      const connection = await h.request('POST', `${api}/provider-connections`, {
        cookie,
        payload: { provider: 'fake', name: 'Trace fixture' },
      });
      expect(connection.statusCode, connection.body).toBe(201);
      for (const [key, value] of [
        ['ai.connection_id', connection.json<{ connection: { id: string } }>().connection.id],
        ['ai.model', 'fake-standard'],
      ]) {
        const response = await h.request('PUT', `${api}/settings/assignments`, {
          cookie,
          payload: {
            key,
            scopeType: 'workspace',
            scopeId: h.ids.workspaceA,
            value,
            reason: 'Trace fixture',
          },
        });
        expect(response.statusCode, response.body).toBe(200);
      }
      const created = await h.request('POST', `${api}/projects`, {
        cookie,
        payload: {
          code: 'trace',
          title: 'Trace fixture',
          initialProblem: `Reduce customer churn. ${canary}`,
          topics: [{ topicId: topic.json<{ topic: { id: string } }>().topic.id }],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const project = created.json<{ project: { id: string; version: number } }>().project;
      projectId = project.id;
      // The HTTP server span is supplied here; authorization, interceptor, carrier serialization,
      // Temporal worker wrapper and ProviderRuntime are the actual application components.
      await trace.getTracer('fixture.http').startActiveSpan('api.request', async (span) => {
        rootSpanId = span.spanContext().spanId;
        rootTraceId = span.spanContext().traceId;
        span.setAttribute('url.full', canary);
        try {
          const response = await h!.request('POST', `${api}/projects/${projectId}/activate`, {
            cookie,
            headers: { 'x-request-id': requestId },
            payload: { expectedVersion: project.version },
          });
          expect(response.statusCode, response.body).toBe(200);
          expect(response.headers['x-request-id']).toBe(requestId);
        } finally {
          span.end();
        }
      });
      await expect
        .poll(
          async () =>
            (
              await h!.admin.query<{ count: number }>(
                'select count(*)::int as count from model_invocations where project_id=$1',
                [projectId],
              )
            ).rows[0]!.count,
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      await expect
        .poll(
          () =>
            records.filter(
              (row) =>
                row['event'] === 'provider.invoke.completed' && row['requestId'] === requestId,
            ).length,
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
      await h.close();
      h = undefined;
      await sdk.shutdown();
      const provider = spans.find(
        (span) =>
          span.name === 'provider.invoke' && span.attributes['docoo.projectId'] === projectId,
      )!;
      expect(provider).toBeDefined();
      expect(provider.traceId).toBe(rootTraceId);
      const activity = spans.find((span) => span.spanId === provider.parentSpanId)!;
      expect(activity.name).toBe('workflow.activity');
      expect(activity.parentSpanId).toBe(rootSpanId);
      const root = spans.find((span) => span.spanId === rootSpanId)!;
      expect(root.attributes).toMatchObject({
        'docoo.requestId': requestId,
        'docoo.projectId': projectId,
      });
      expect(provider.attributes).toMatchObject({
        'docoo.requestId': requestId,
        'docoo.projectId': projectId,
      });
      expect(provider.attributes['docoo.temporalRunId']).toMatch(/^[0-9a-f-]{36}$/u);
      const correlated = records.filter((row) => row['requestId'] === requestId);
      expect(correlated.length).toBeGreaterThan(2);
      for (const record of records)
        for (const key of correlationKeys) expect(record).toHaveProperty(key);
      expect(JSON.stringify({ spans, records })).not.toContain(canary);
    } finally {
      await h?.close();
      await sdk.shutdown();
      trace.disable();
      context.disable();
      writer.mockRestore();
    }
  },
  60_000,
);
