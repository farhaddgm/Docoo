'use client';

import { useState, type FormEvent } from 'react';
import { apiSend } from '../../../api-client';
import { formatNumber, type Locale } from '../../../i18n';

interface Preview {
  setId: string;
  criteriaVersionId: string | null;
  preview: {
    criteria: { key: string; label: string; weight: number; enabled: boolean }[];
    ranking: { id: string; total: number; rank: number }[];
  };
  intervals: { from: number; to: number; winnerIds: string[] }[];
}

export function SensitivityPanel({
  locale,
  base,
  setId,
  criteriaVersionId,
  criteria,
  alternatives,
}: {
  locale: Locale;
  base: string;
  setId: string;
  criteriaVersionId: string | null;
  criteria: { key: string; label: string; weight: number; enabled: boolean }[];
  alternatives: { id: string; title: string }[];
}) {
  const fa = locale === 'fa';
  const enabled = criteria.filter((c) => c.enabled);
  const [key, setKey] = useState(enabled[0]?.key ?? '');
  const [weight, setWeight] = useState(enabled[0]?.weight ?? 100);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const names = new Map(alternatives.map((a) => [a.id, a.title]));

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const result = await apiSend<{ sensitivity: Preview }>(
        'POST',
        `${base}/solutions/sensitivity`,
        { criterionKey: key, weight },
      );
      if (
        result.sensitivity.setId !== setId ||
        result.sensitivity.criteriaVersionId !== criteriaVersionId
      )
        throw new Error('Stale preview');
      setPreview(result.sensitivity);
    } catch {
      setError(true);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="sensitivity-title">
      <h2 id="sensitivity-title">
        {fa ? 'حساسیت تصمیم به وزن معیارها' : 'Sensitivity to criterion weights'}
      </h2>
      <p className="muted">
        {fa
          ? 'یک وزن را تغییر دهید تا رتبه‌ها و بازه‌های برنده را ببینید. وزن‌های دیگر متناسب بازتوزیع می‌شوند و جمع ۱۰۰ می‌ماند؛ اگر همه صفر باشند، سهم برابر می‌گیرند. محاسبه با گام یک درصد انجام می‌شود و معیار ذخیره‌شده تغییر نمی‌کند.'
          : 'Change one weight to preview ranks and winning ranges. Other weights keep their proportions, or equal shares when all are zero, and total 100. Calculations use one-percent steps and leave saved criteria unchanged.'}
      </p>
      <form className="filter-form" onSubmit={(event) => void calculate(event)} aria-busy={busy}>
        <label htmlFor="sensitivity-criterion">{fa ? 'معیار' : 'Criterion'}</label>
        <select
          id="sensitivity-criterion"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setWeight(enabled.find((c) => c.key === event.target.value)?.weight ?? 100);
            setPreview(null);
          }}
        >
          {enabled.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <label htmlFor="sensitivity-weight">
          {fa ? 'وزن آزمایشی' : 'Preview weight'}: {formatNumber(locale, weight)}%
        </label>
        <input
          id="sensitivity-weight"
          type="range"
          min={enabled.length === 1 ? 100 : 0}
          max={100}
          step={1}
          value={weight}
          onChange={(event) => {
            setWeight(Number(event.target.value));
            setPreview(null);
          }}
        />
        <button type="submit" className="secondary-button" disabled={busy || !key}>
          {fa ? 'محاسبهٔ رتبه‌ها' : 'Calculate ranks'}
        </button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {fa
            ? 'محاسبه انجام نشد؛ صفحه را تازه کنید و دوباره تلاش کنید.'
            : 'Could not calculate. Refresh the page and try again.'}
        </p>
      )}
      {preview && (
        <div className="stack" aria-live="polite">
          <p>
            {preview.preview.criteria
              .filter((c) => c.enabled)
              .map((c) => `${c.label}: ${formatNumber(locale, c.weight)}%`)
              .join(' · ')}
          </p>
          <div className="table-scroll">
            <table>
              <caption>{fa ? 'رتبه در وزن آزمایشی' : 'Ranks at the preview weight'}</caption>
              <thead>
                <tr>
                  <th>{fa ? 'رتبه' : 'Rank'}</th>
                  <th>{fa ? 'راه‌حل' : 'Solution'}</th>
                  <th>{fa ? 'امتیاز' : 'Score'}</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.ranking.map((r) => (
                  <tr key={r.id}>
                    <td>{formatNumber(locale, r.rank)}</td>
                    <td dir="auto">{names.get(r.id)}</td>
                    <td>{formatNumber(locale, r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table>
              <caption>
                {fa
                  ? 'برنده در بازه‌های وزن؛ نام‌های متعدد یعنی تساوی'
                  : 'Winners across weight ranges; multiple names indicate a tie'}
              </caption>
              <thead>
                <tr>
                  <th>{fa ? 'وزن معیار' : 'Criterion weight'}</th>
                  <th>{fa ? 'برنده' : 'Winner'}</th>
                </tr>
              </thead>
              <tbody>
                {preview.intervals.map((r) => (
                  <tr key={r.from}>
                    <td>
                      {formatNumber(locale, r.from)}–{formatNumber(locale, r.to)}%
                    </td>
                    <td dir="auto">{r.winnerIds.map((id) => names.get(id)).join('، ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
