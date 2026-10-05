'use client';

import { useEffect, useState } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { selfCheckMessages } from './self-check-messages';

interface Result {
  step: string;
  status: 'passed' | 'failed';
  problem: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  errorKind: string | null;
  finishReason: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  priced: boolean;
}

type Row = { state: 'waiting' } | { state: 'running' } | { state: 'done'; result: Result };

/**
 * One click that tries every kind of call the platform makes against the chosen connection and
 * model, one request at a time, and says what works and why not. A report of the outcome can be
 * copied to send along.
 */
export function ModelSelfCheck({
  locale,
  workspaceId,
  connections,
  modelIds,
  current,
}: {
  locale: Locale;
  workspaceId: string;
  connections: readonly { id: string; name: string; provider: string }[];
  modelIds: Readonly<Record<string, readonly string[]>>;
  current: { connectionId: string; model: string };
}) {
  const text = selfCheckMessages(locale);
  const base = `/workspaces/${workspaceId}`;
  const [connectionId, setConnectionId] = useState('');
  const [model, setModel] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [running, setRunning] = useState(false);
  const [stoppedAuth, setStoppedAuth] = useState(false);
  const [finished, setFinished] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');

  // Start from the model in use.
  useEffect(() => {
    if (!connectionId && current.connectionId) setConnectionId(current.connectionId);
    if (!model && current.model) setModel(current.model);
  }, [current, connectionId, model]);
  useEffect(() => {
    if (!connectionId) return;
    apiGet<{ steps: string[] }>(`${base}/provider-connections/${connectionId}/self-check`)
      .then((result) => setSteps(result.steps))
      .catch(() => undefined);
  }, [base, connectionId]);

  const selected = connections.find((item) => item.id === connectionId);
  const suggestions = connectionId
    ? (modelIds[connections.find((item) => item.id === connectionId)?.id ?? ''] ?? [])
    : [];
  const done = steps.flatMap((step) => {
    const row = rows[step];
    return row?.state === 'done' ? [row.result] : [];
  });
  const failed = done.filter((item) => item.status === 'failed').length;

  async function run() {
    if (running || !connectionId || model.trim() === '') return;
    setRunning(true);
    setFinished(false);
    setStoppedAuth(false);
    setCopyNotice('');
    setRows(Object.fromEntries(steps.map((step) => [step, { state: 'waiting' }])));
    for (const step of steps) {
      setRows((all) => ({ ...all, [step]: { state: 'running' } }));
      let result: Result;
      try {
        result = (
          await apiSend<{ result: Result }>(
            'POST',
            `${base}/provider-connections/${connectionId}/self-check`,
            { model: model.trim(), step, language: locale },
          )
        ).result;
      } catch {
        result = {
          step,
          status: 'failed',
          problem: null,
          errorCode: 'request_failed',
          errorDetail: null,
          errorKind: null,
          finishReason: null,
          latencyMs: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          costUsd: null,
          priced: false,
        };
      }
      setRows((all) => ({ ...all, [step]: { state: 'done', result } }));
      if (result.errorKind === 'auth') {
        setStoppedAuth(true);
        break;
      }
    }
    setRunning(false);
    setFinished(true);
  }

  const seconds = (ms: number | null) =>
    ms === null ? '—' : `${formatNumber(locale, Math.round(ms / 100) / 10)} ${text.seconds}`;
  const money = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 4,
        }).format(value);
  const noteOf = (result: Result): string => {
    if (result.status === 'passed') return '';
    const parts = [
      result.errorKind ? (text.kinds[result.errorKind] ?? result.errorKind) : '',
      result.problem ? (text.problems[result.problem] ?? result.problem) : '',
      result.errorCode ?? '',
      result.errorDetail ?? '',
    ].filter(Boolean);
    return parts.join(' · ');
  };

  const report = [
    `Docoo model self-check · ${selected?.provider ?? ''} · ${model.trim()} · ${new Date().toISOString()}`,
    ...done.map((item) =>
      [
        item.step,
        item.status,
        item.latencyMs === null ? '-' : `${item.latencyMs}ms`,
        `tokens ${item.inputTokens ?? '-'}/${item.outputTokens ?? '-'}`,
        item.costUsd === null ? '' : `$${item.costUsd}${item.priced ? '' : ' (estimated)'}`,
        item.errorCode ?? '',
        item.problem ?? '',
        item.errorDetail ?? '',
      ]
        .filter(Boolean)
        .join(' | '),
    ),
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopyNotice(text.copied);
    } catch {
      setCopyNotice(text.copyFailed);
    }
  }

  return (
    <section className="card stack" aria-labelledby="selfcheck-title">
      <h2 id="selfcheck-title">{text.title}</h2>
      <p className="muted">{text.help}</p>
      <div className="filter-grid">
        <label htmlFor="selfcheck-connection">{text.connection}</label>
        <select
          id="selfcheck-connection"
          value={connectionId}
          disabled={running}
          onChange={(event) => setConnectionId(event.target.value)}
        >
          <option value="">—</option>
          {connections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label htmlFor="selfcheck-model">{text.model}</label>
        <input
          id="selfcheck-model"
          dir="ltr"
          list="selfcheck-model-options"
          value={model}
          disabled={running}
          placeholder={text.modelPlaceholder}
          autoComplete="off"
          onChange={(event) => setModel(event.target.value)}
        />
        <datalist id="selfcheck-model-options">
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>
      <div className="toolbar">
        <button
          className="primary-button"
          type="button"
          disabled={running || !connectionId || model.trim() === '' || steps.length === 0}
          onClick={() => void run()}
        >
          {running ? text.running : text.start}
        </button>
      </div>

      {Object.keys(rows).length > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="selfcheck-title">
          <table>
            <caption className="visually-hidden">{text.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{text.step}</th>
                <th scope="col">{text.status}</th>
                <th scope="col">{text.time}</th>
                <th scope="col">{text.tokens}</th>
                <th scope="col">{text.cost}</th>
                <th scope="col">{text.note}</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => {
                const row = rows[step];
                const result = row?.state === 'done' ? row.result : null;
                return (
                  <tr key={step}>
                    <th scope="row">{text.steps[step] ?? step}</th>
                    <td>
                      {result ? (
                        <span
                          className={`badge ${result.status === 'passed' ? 'state-passed' : 'state-failed'}`}
                        >
                          {result.status === 'passed' ? text.passed : text.failed}
                        </span>
                      ) : row?.state === 'running' ? (
                        text.inProgress
                      ) : (
                        text.waiting
                      )}
                    </td>
                    <td>{result ? seconds(result.latencyMs) : '—'}</td>
                    <td dir="ltr">
                      {result && result.inputTokens !== null
                        ? `${formatNumber(locale, result.inputTokens)} / ${formatNumber(locale, result.outputTokens ?? 0)}`
                        : '—'}
                    </td>
                    <td>
                      {result ? money(result.costUsd) : '—'}
                      {result && result.costUsd !== null && !result.priced && (
                        <small className="muted"> ({text.estimated})</small>
                      )}
                    </td>
                    <td dir="auto">{result ? noteOf(result) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div role="status" aria-live="polite">
        {stoppedAuth && <p className="notice error">{text.stoppedAuth}</p>}
        {finished && failed === 0 && done.length === steps.length && (
          <p className="notice ok">
            {fill(text.allPassed, { n: formatNumber(locale, steps.length) })}
          </p>
        )}
        {finished && failed > 0 && (
          <p className="notice error">
            {fill(text.someFailed, {
              failed: formatNumber(locale, failed),
              n: formatNumber(locale, steps.length),
            })}
          </p>
        )}
      </div>

      {finished && done.length > 0 && (
        <div className="field-stack">
          <label htmlFor="selfcheck-report">{text.report}</label>
          <textarea
            id="selfcheck-report"
            dir="ltr"
            rows={Math.min(14, done.length + 3)}
            readOnly
            value={report}
          />
          <div className="toolbar">
            <button className="secondary-button" type="button" onClick={() => void copy()}>
              {text.copy}
            </button>
            {copyNotice && <span role="status">{copyNotice}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
