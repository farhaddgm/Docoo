'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiPost } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { SectionTitle } from '../../info-tip';
import { fill } from '../agents/agent-messages';
import { Notice, useAction } from '../use-action';
import { semanticMessages } from './semantic-messages';

interface Status {
  enabled: boolean;
  reason: string | null;
  model: string | null;
  eligible: number;
  embedded: number;
  keptLocal: number;
  heldBack: number;
}

/** ADR-0061: whether semantic search is on, how much knowledge it covers, and a button to catch up. */
export function SemanticCard({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = semanticMessages(locale);
  const base = `/workspaces/${workspaceId}/knowledge/semantic-index`;
  const [status, setStatus] = useState<Status | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { busy, notice, run: act } = useAction(() => text.error);

  const load = useCallback(async () => {
    setStatus(await apiGet<Status>(base));
  }, [base]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  function run() {
    void (async () => {
      let summary = '';
      const ok = await act(async () => {
        const response = (await (await apiPost(`${base}/run`, { limit: 500 })).json()) as {
          embedded?: number;
          failedBatches?: number;
        };
        summary = fill(text.done, {
          embedded: formatNumber(locale, response.embedded ?? 0),
          failed: response.failedBatches
            ? fill(text.failed, { n: formatNumber(locale, response.failedBatches) })
            : '',
        });
        await load();
      }, '');
      if (ok) setResult(summary);
    })();
  }

  if (status === null) return null;
  return (
    <section className="card stack" aria-labelledby="semantic-title">
      <SectionTitle id="semantic-title" help={text.help}>
        {text.title}
      </SectionTitle>
      {!status.enabled ? (
        <p className="muted">
          {text.off[status.reason ?? 'not_enabled'] ?? text.off['not_enabled']}
        </p>
      ) : (
        <>
          <p>{fill(text.on, { model: status.model ?? '—' })}</p>
          <p>
            {fill(text.progress, {
              embedded: formatNumber(locale, status.embedded),
              eligible: formatNumber(locale, status.eligible),
            })}
          </p>
          {status.keptLocal > 0 && (
            <p className="muted">
              {fill(text.local, { n: formatNumber(locale, status.keptLocal) })}
            </p>
          )}
          {status.heldBack > 0 && (
            <p className="muted">{fill(text.held, { n: formatNumber(locale, status.heldBack) })}</p>
          )}
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={busy || status.embedded + status.heldBack >= status.eligible}
              onClick={run}
            >
              {busy ? text.running : text.run}
            </button>
          </div>
          {result && (
            <p className="notice ok" role="status">
              {result}
            </p>
          )}
        </>
      )}
      <Notice notice={notice} />
    </section>
  );
}
