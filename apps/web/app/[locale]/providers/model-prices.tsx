'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import { priceMessages } from './price-messages';

type Kind = 'openai' | 'gemini' | 'anthropic';

interface Price {
  id: string;
  provider: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number | null;
  reasoningPerMillion: number | null;
  effectiveFrom: string;
}

interface PriceView {
  items: Price[];
  fallback: { inputPerMillion: number; outputPerMillion: number };
  defaultModel: { provider: string; model: string; priced: boolean } | null;
}

/** A price in USD per million tokens, or undefined when the text is empty or not a valid price. */
function parsePrice(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : undefined;
}

/**
 * Prices make the cost figures and the cost ceiling true. Without a price for the model in use,
 * calls are estimated with a high fallback; the banner says so and the form fixes it.
 */
export function ModelPrices({
  locale,
  workspaceId,
  kinds,
  modelIds,
  refreshKey,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  /** Providers the workspace has a connection for. */
  kinds: readonly Kind[];
  /** Model ids from the connections' catalogs, offered as suggestions. */
  modelIds: Readonly<Record<string, readonly string[]>>;
  refreshKey: number;
  onChanged: () => void;
}) {
  const text = priceMessages(locale);
  const base = `/workspaces/${workspaceId}`;
  const [view, setView] = useState<PriceView | null>(null);
  const [provider, setProvider] = useState<Kind>(kinds[0] ?? 'openai');
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [cached, setCached] = useState('');
  const [reasoning, setReasoning] = useState('');
  const explain = useCallback((error: unknown) => explainError(error, {}, text.failed), [text]);
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(async () => {
    setView(await apiGet<PriceView>(`${base}/model-prices`));
  }, [base]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load, refreshKey]);

  // The model in use is the one to price first.
  useEffect(() => {
    if (view?.defaultModel && !model) {
      setModel(view.defaultModel.model);
      const known = kinds.find((item) => item === view.defaultModel?.provider);
      if (known) setProvider(known);
    }
  }, [view, model, kinds]);

  const latest = new Map<string, Price>();
  for (const item of view?.items ?? []) {
    const key = `${item.provider}:${item.model}`;
    if (!latest.has(key)) latest.set(key, item);
  }
  const inputPrice = parsePrice(input);
  const outputPrice = parsePrice(output);
  const cachedPrice = parsePrice(cached);
  const reasoningPrice = parsePrice(reasoning);
  const valid =
    model.trim() !== '' &&
    inputPrice !== undefined &&
    outputPrice !== undefined &&
    (cached.trim() === '' || cachedPrice !== undefined) &&
    (reasoning.trim() === '' || reasoningPrice !== undefined);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    void run(async () => {
      await apiSend('POST', `${base}/model-prices`, {
        provider,
        model: model.trim(),
        inputPerMillion: inputPrice,
        outputPerMillion: outputPrice,
        ...(cachedPrice !== undefined ? { cachedInputPerMillion: cachedPrice } : {}),
        ...(reasoningPrice !== undefined ? { reasoningPerMillion: reasoningPrice } : {}),
        effectiveFrom: new Date().toISOString(),
      });
      setInput('');
      setOutput('');
      setCached('');
      setReasoning('');
      await load();
      onChanged();
    }, text.saved);
  }

  const num = (value: number | null) => (value === null ? '—' : formatNumber(locale, value));
  const suggestions = modelIds[provider] ?? [];

  return (
    <section className="card stack" aria-labelledby="prices-title">
      <h2 id="prices-title">{text.title}</h2>
      <p className="muted">{text.help}</p>
      {view?.defaultModel &&
        (view.defaultModel.priced ? (
          <p className="notice ok" role="status">
            {text.pricedOk}
          </p>
        ) : (
          <div className="notice warn" role="status">
            <strong>{text.unpricedTitle}</strong>
            <p>
              {fill(text.unpriced, {
                model: view.defaultModel.model,
                input: formatNumber(locale, view.fallback.inputPerMillion),
                output: formatNumber(locale, view.fallback.outputPerMillion),
              })}
            </p>
          </div>
        ))}
      {view && latest.size === 0 && <p className="muted">{text.none}</p>}
      {latest.size > 0 && (
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="prices-title">
          <table>
            <caption className="visually-hidden">{text.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{text.provider}</th>
                <th scope="col">{text.model}</th>
                <th scope="col">{text.input}</th>
                <th scope="col">{text.output}</th>
                <th scope="col">{text.cached}</th>
                <th scope="col">{text.reasoning}</th>
                <th scope="col">{text.since}</th>
              </tr>
            </thead>
            <tbody>
              {[...latest.values()].map((item) => (
                <tr key={item.id}>
                  <td dir="ltr">{item.provider}</td>
                  <th scope="row" dir="ltr">
                    {item.model}
                  </th>
                  <td>{num(item.inputPerMillion)}</td>
                  <td>{num(item.outputPerMillion)}</td>
                  <td>{num(item.cachedInputPerMillion)}</td>
                  <td>{num(item.reasoningPerMillion)}</td>
                  <td>{formatDateTime(locale, item.effectiveFrom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{text.perMillion}</p>

      <form className="field-stack" onSubmit={submit} aria-busy={busy}>
        <Notice notice={notice} />
        <div className="filter-grid">
          <label htmlFor="price-provider">{text.provider}</label>
          <select
            id="price-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Kind)}
          >
            {(kinds.length > 0 ? kinds : (['openai', 'gemini', 'anthropic'] as const)).map(
              (item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </select>
          <label htmlFor="price-model">{text.modelLabel}</label>
          <input
            id="price-model"
            dir="ltr"
            list="price-model-options"
            value={model}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id="price-model-options">
            {suggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <label htmlFor="price-input">{text.inputLabel}</label>
          <input
            id="price-input"
            dir="ltr"
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <label htmlFor="price-output">{text.outputLabel}</label>
          <input
            id="price-output"
            dir="ltr"
            inputMode="decimal"
            value={output}
            onChange={(event) => setOutput(event.target.value)}
          />
          <label htmlFor="price-cached">{text.cachedLabel}</label>
          <input
            id="price-cached"
            dir="ltr"
            inputMode="decimal"
            value={cached}
            onChange={(event) => setCached(event.target.value)}
          />
          <label htmlFor="price-reasoning">{text.reasoningLabel}</label>
          <input
            id="price-reasoning"
            dir="ltr"
            inputMode="decimal"
            value={reasoning}
            onChange={(event) => setReasoning(event.target.value)}
          />
        </div>
        {!valid && (input !== '' || output !== '') && <p className="muted">{text.needNumbers}</p>}
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy || !valid}>
            {busy ? text.adding : text.add}
          </button>
        </div>
      </form>
    </section>
  );
}
