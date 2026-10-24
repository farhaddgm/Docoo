'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiSend } from '../../../api-client';
import { formatNumber, type Locale, textDir } from '../../../i18n';
import { stabilityVerdict, type StabilityResult } from './criteria-weights';

interface Preview {
  setId: string;
  criteriaVersionId: string | null;
  preview: {
    criteria: { key: string; label: string; weight: number; enabled: boolean }[];
    ranking: { id: string; total: number; rank: number }[];
  };
  intervals: { from: number; to: number; winnerIds: string[] }[];
  stability: StabilityResult;
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
  const labels = new Map(criteria.map((c) => [c.key, c.label]));
  const [stability, setStability] = useState<StabilityResult | null>(null);

  // The verdict covers every criterion at once, so it is asked for as the panel opens.
  useEffect(() => {
    const first = criteria.find((c) => c.enabled);
    if (!first) return;
    let cancelled = false;
    apiSend<{ sensitivity: Preview }>('POST', `${base}/solutions/sensitivity`, {
      criterionKey: first.key,
      weight: first.weight,
    })
      .then(({ sensitivity }) => {
        if (
          !cancelled &&
          sensitivity.setId === setId &&
          sensitivity.criteriaVersionId === criteriaVersionId
        )
          setStability(sensitivity.stability);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, setId, criteriaVersionId, criteria]);

  const verdict = stability ? stabilityVerdict(stability) : null;
  const name = (id: string | undefined) => names.get(id ?? '') ?? '';
  const flipText = (flip: { criterionKey: string; from: number | null; to: number | null }) => {
    const label = labels.get(flip.criterionKey) ?? flip.criterionKey;
    const from = flip.from ?? 0;
    const to = flip.to ?? 100;
    if (from > 0 && to >= 100)
      return fa
        ? `اگر وزن «${label}» از ${formatNumber(locale, from)}٪ کمتر شود`
        : `if the weight of “${label}” drops below ${formatNumber(locale, from)}%`;
    if (from <= 0 && to < 100)
      return fa
        ? `اگر وزن «${label}» از ${formatNumber(locale, to)}٪ بیشتر شود`
        : `if the weight of “${label}” rises above ${formatNumber(locale, to)}%`;
    return fa
      ? `اگر وزن «${label}» خارج از ${formatNumber(locale, from)} تا ${formatNumber(locale, to)}٪ برود`
      : `if the weight of “${label}” leaves ${formatNumber(locale, from)}–${formatNumber(locale, to)}%`;
  };

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
      <h2 id="sensitivity-title">{fa ? 'پایداری تصمیم' : 'Decision stability'}</h2>
      {verdict === null && (
        <p className="muted" role="status">
          {fa ? 'در حال بررسی پایداری رتبه‌بندی…' : 'Checking how stable the ranking is…'}
        </p>
      )}
      {verdict?.kind === 'tie' && (
        <p role="status">
          {fa
            ? 'در وزن‌های فعلی چند راه‌حل امتیاز برابر دارند و برندهٔ یکتا وجود ندارد.'
            : 'At the current weights several solutions tie, so there is no single winner.'}
        </p>
      )}
      {verdict?.kind === 'stable' && (
        <p role="status">
          <span className="badge state-passed">{fa ? 'پایدار' : 'Stable'}</span>{' '}
          {fa
            ? `«${name(verdict.winnerId)}» با هر وزنی از هر معیار برنده می‌ماند؛ می‌توانید با اطمینان انتخاب کنید.`
            : `“${name(verdict.winnerId)}” stays the winner at any weight of any criterion, so you can choose with confidence.`}
        </p>
      )}
      {verdict?.kind === 'fragile' && (
        <p role="status">
          <span className="badge state-failed">{fa ? 'شکننده' : 'Fragile'}</span>{' '}
          {fa
            ? `برندهٔ فعلی «${name(verdict.winnerId)}» است، اما ${verdict.flips.slice(0, 3).map(flipText).join('، یا ')}، برنده عوض می‌شود.`
            : `The current winner is “${name(verdict.winnerId)}”, but the winner changes ${verdict.flips.slice(0, 3).map(flipText).join(', or ')}.`}
          {verdict.flips.length > 3 &&
            (fa
              ? ` (و ${formatNumber(locale, verdict.flips.length - 3)} معیار دیگر)`
              : ` (and ${formatNumber(locale, verdict.flips.length - 3)} more)`)}
        </p>
      )}
      <details className="compact-details">
        <summary>{fa ? 'پیشرفته: آزمایش دستی وزن‌ها' : 'Advanced: try weights by hand'}</summary>
        <div className="stack">
          <p className="muted">
            {fa
              ? 'یک معیار را انتخاب کنید و وزنش را تغییر دهید تا ببینید رتبه‌ها چه می‌شود. معیارهای ذخیره‌شده تغییر نمی‌کنند.'
              : 'Pick a criterion and change its weight to see how the ranks move. Saved criteria stay unchanged.'}
          </p>
          <details>
            <summary>{fa ? 'بیشتر بدانید' : 'Learn more'}</summary>
            <p className="muted">
              {fa
                ? 'وزن‌های دیگر متناسب بازتوزیع می‌شوند و جمع ۱۰۰ می‌ماند؛ اگر همه صفر باشند، سهم برابر می‌گیرند. محاسبه برای هر عدد صحیح ۰ تا ۱۰۰ (گام یک درصد) انجام می‌شود، بنابراین «بازه‌های برنده» بین دو گام را حدس نمی‌زنند. نام‌های متعدد در یک بازه یعنی تساوی.'
                : 'Other weights keep their proportions, or equal shares when all are zero, and total 100. Calculations use every whole percent from 0 to 100, so winning ranges never guess between steps. Several names in one range indicate a tie.'}
            </p>
          </details>
          {stability && (
            <div className="table-scroll">
              <table>
                <caption>
                  {fa ? 'پایداری برنده به تفکیک معیار' : 'Winner stability by criterion'}
                </caption>
                <thead>
                  <tr>
                    <th>{fa ? 'معیار' : 'Criterion'}</th>
                    <th>{fa ? 'وضعیت' : 'Status'}</th>
                    <th>
                      {fa ? 'برنده فعلی برنده می‌ماند در وزن' : 'Current winner holds at weight'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stability.criteria.map((c) => (
                    <tr key={c.criterionKey}>
                      <td dir={textDir(locale)}>{labels.get(c.criterionKey) ?? c.criterionKey}</td>
                      <td>{c.stable ? (fa ? 'پایدار' : 'Stable') : fa ? 'شکننده' : 'Fragile'}</td>
                      <td>
                        {c.holdsFrom === null || c.holdsTo === null
                          ? '—'
                          : `${formatNumber(locale, c.holdsFrom)}–${formatNumber(locale, c.holdsTo)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form
            className="filter-form"
            onSubmit={(event) => void calculate(event)}
            aria-busy={busy}
          >
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
                        <td dir={textDir(locale)}>{names.get(r.id)}</td>
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
                        <td dir={textDir(locale)}>
                          {r.winnerIds.map((id) => names.get(id)).join('، ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
