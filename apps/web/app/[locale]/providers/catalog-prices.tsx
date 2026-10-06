'use client';

import { useCallback, useMemo, useState } from 'react';

import { apiSend } from '../../api-client';
import { formatDateTime, formatNumber, formatPrice, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import { catalogMessages } from './catalog-messages';

type Status = 'new' | 'changed' | 'same' | 'none' | 'unusable';

interface Suggestion {
  provider: 'openai' | 'gemini' | 'anthropic';
  model: string;
  isDefault: boolean;
  status: Status;
  match: 'exact' | 'alias' | null;
  reason: 'zero_price' | 'no_price' | null;
  current: {
    inputPerMillion: number;
    outputPerMillion: number;
    source: string;
  } | null;
  catalog: {
    inputPerMillion: number;
    outputPerMillion: number;
    cachedInputPerMillion: number | null;
    reasoningPerMillion: number | null;
    deprecationDate: string | null;
    tiered: boolean;
  } | null;
}

interface Preview {
  catalog: { source: string; hash: string; fetchedAt: string; entryCount: number };
  needsModelList: boolean;
  items: Suggestion[];
}

interface SaveResult {
  imported: unknown[];
  skipped: unknown[];
}

const keyOf = (item: Suggestion) => `${item.provider}:${item.model}`;
const canSave = (item: Suggestion) => item.status === 'new' || item.status === 'changed';

/**
 * Prices from the public catalog (ADR-0022): a preview next to the current prices, then the
 * administrator's own choice. The request names models only; the server saves its own copy of the figures.
 */
export function CatalogPrices({
  locale,
  workspaceId,
  onSaved,
}: {
  locale: Locale;
  workspaceId: string;
  onSaved: () => void;
}) {
  const text = catalogMessages(locale);
  const base = `/workspaces/${workspaceId}/model-prices`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [savedCounts, setSavedCounts] = useState<{ imported: number; skipped: number } | null>(
    null,
  );
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const savable = useMemo(() => (preview?.items ?? []).filter(canSave), [preview]);
  const chosen = savable.filter((item) => selected.has(keyOf(item)));

  function fetchPrices() {
    void run(async () => {
      const result = await apiSend<Preview>('POST', `${base}/catalog-lookup`, {
        refresh: preview !== null,
      });
      setPreview(result);
      // An exact match that is new or different is the likely wish; a guessed (alias) match is not.
      setSelected(
        new Set(result.items.filter((i) => canSave(i) && i.match === 'exact').map(keyOf)),
      );
    }, '');
  }

  function save() {
    if (!preview || chosen.length === 0) return;
    void run(async () => {
      const result = await apiSend<SaveResult>('POST', `${base}/catalog-import`, {
        catalogHash: preview.catalog.hash,
        items: chosen.map((item) => ({ provider: item.provider, model: item.model })),
      });
      setPreview(null);
      setSelected(new Set());
      onSaved();
      setSavedCounts({ imported: result.imported.length, skipped: result.skipped.length });
    }, '');
  }

  function toggle(key: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const pair = (input: number, output: number) =>
    `${formatPrice(locale, input)} / ${formatPrice(locale, output)}`;
  const allChosen = savable.length > 0 && chosen.length === savable.length;

  return (
    <section className="stack" aria-labelledby="catalog-prices-title">
      <h3 id="catalog-prices-title">{text.title}</h3>
      <p className="muted">{text.help}</p>
      <div className="toolbar">
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setSavedCounts(null);
            fetchPrices();
          }}
        >
          {busy && preview === null ? text.fetching : preview ? text.refetch : text.fetch}
        </button>
      </div>
      <Notice notice={notice} />
      {savedCounts && (
        <p className="notice ok" role="status">
          {fill(text.saved, {
            imported: formatNumber(locale, savedCounts.imported),
            skipped: formatNumber(locale, savedCounts.skipped),
          })}
        </p>
      )}

      {preview && (
        <>
          <p className="muted">
            {fill(text.info, {
              // U+2066 … U+2069 keep a Latin name from reordering the surrounding Persian sentence.
              source: `\u2066${preview.catalog.source}\u2069`,
              count: formatNumber(locale, preview.catalog.entryCount),
              time: formatDateTime(locale, preview.catalog.fetchedAt),
            })}
          </p>
          {preview.needsModelList && (
            <p className="notice warn" role="status">
              {text.needsModelList}
            </p>
          )}
          {savable.length === 0 && (
            <p className="notice ok" role="status">
              {text.allSame}
            </p>
          )}
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-labelledby="catalog-prices-title"
          >
            <table className="catalog-table">
              <caption className="visually-hidden">{text.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      checked={allChosen}
                      disabled={savable.length === 0}
                      aria-label={text.selectAll}
                      onChange={(event) =>
                        setSelected(event.target.checked ? new Set(savable.map(keyOf)) : new Set())
                      }
                    />
                  </th>
                  <th scope="col">{text.provider}</th>
                  <th scope="col">{text.model}</th>
                  <th scope="col">{text.status}</th>
                  <th scope="col">{text.current}</th>
                  <th scope="col">{text.fromCatalog}</th>
                  <th scope="col">{text.notes}</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => {
                  const key = keyOf(item);
                  const notes: string[] = [];
                  const catalog = item.catalog;
                  if (item.reason) notes.push(text.reasons[item.reason]);
                  if (item.match === 'alias') notes.push(text.alias);
                  if (catalog?.tiered) notes.push(text.tiered);
                  if (catalog?.deprecationDate) {
                    notes.push(fill(text.retiring, { date: catalog.deprecationDate }));
                  }
                  if (catalog && catalog.cachedInputPerMillion !== null) {
                    notes.push(
                      fill(text.cachedOf, {
                        value: formatPrice(locale, catalog.cachedInputPerMillion),
                      }),
                    );
                  }
                  if (catalog && catalog.reasoningPerMillion !== null) {
                    notes.push(
                      fill(text.reasoningOf, {
                        value: formatPrice(locale, catalog.reasoningPerMillion),
                      }),
                    );
                  }
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          disabled={!canSave(item)}
                          aria-label={`${text.select}: ${item.model}`}
                          onChange={(event) => toggle(key, event.target.checked)}
                        />
                      </td>
                      <td dir="ltr">{item.provider}</td>
                      <th scope="row" dir="ltr" className="model-cell">
                        {item.model}
                        {item.isDefault && <span className="badge">{text.isDefault}</span>}
                      </th>
                      <td>
                        <span
                          className={`badge ${
                            item.status === 'unusable'
                              ? 'state-invalid'
                              : item.status === 'changed'
                                ? 'state-degraded'
                                : item.status === 'new'
                                  ? 'state-healthy'
                                  : ''
                          }`}
                        >
                          {text.statuses[item.status]}
                        </span>
                      </td>
                      <td dir="ltr">
                        {item.current
                          ? `${pair(item.current.inputPerMillion, item.current.outputPerMillion)} (${
                              text.sources[item.current.source as 'manual' | 'catalog'] ??
                              item.current.source
                            })`
                          : '—'}
                      </td>
                      <td dir="ltr">
                        {item.catalog
                          ? pair(item.catalog.inputPerMillion, item.catalog.outputPerMillion)
                          : '—'}
                      </td>
                      <td className="notes-cell">{notes.join(' · ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <button
              className="primary-button"
              type="button"
              disabled={busy || chosen.length === 0}
              onClick={save}
            >
              {busy ? text.saving : fill(text.save, { count: formatNumber(locale, chosen.length) })}
            </button>
            {chosen.length === 0 && savable.length > 0 && (
              <span className="muted">{text.nothingSelected}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
