'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiSend } from '../../../api-client';
import { formatNumber, type Locale, textDir } from '../../../i18n';
import {
  agreementLevel,
  initialOrder,
  moveKey,
  sharePercent,
  type DecisionMatrixResult,
} from './decision-matrix-view';

type Mode = 'free' | 'ordinal' | 'fixed';

interface Row {
  id: string;
  title: string;
  /** The 1–5 score of each criterion, by criterion key. */
  raw: Record<string, number>;
}

const SPREADS = [0, 0.5, 1, 1.5] as const;

const words = {
  fa: {
    title: 'ماتریس تصمیم',
    intro:
      'این بخش فقط کاوش می‌کند و امتیاز رسمی را عوض نمی‌کند. اگر وزن‌ها را ندانید، فقط ترتیب اهمیت را بچینید؛ سامانه با هزاران وزن ممکن و کمی عدم‌قطعیت در امتیازها می‌سنجد هر راه‌حل چند بار اول می‌شود.',
    order: 'ترتیب اهمیت معیارها',
    orderHelp: 'مهم‌ترین معیار بالاتر باشد.',
    up: 'بالاتر',
    down: 'پایین‌تر',
    weightsFrom: 'وزن‌ها',
    modes: {
      free: 'نمی‌دانم (هر وزنی ممکن است)',
      ordinal: 'فقط ترتیب اهمیت را می‌دانم',
      fixed: 'وزن‌های ثبت‌شده درست‌اند',
    } as Record<Mode, string>,
    useRoc: 'رتبه‌بندی را هم با وزن‌های برآمده از این ترتیب نشان بده',
    spread: 'عدم‌قطعیت امتیازها',
    spreads: ['دقیق', 'کم (±۰٫۵)', 'متوسط (±۱)', 'زیاد (±۱٫۵)'],
    spreadHelp: 'هرچه شواهد ضعیف‌تر است، عدم‌قطعیت را بیشتر بگیرید.',
    minimums: 'حداقل لازم (وتو)',
    minimumsHelp: 'راه‌حل زیر این امتیاز، هرچه بقیه‌ی امتیازهایش باشد، کنار گذاشته می‌شود.',
    none: 'بدون شرط',
    atLeast: 'دست‌کم',
    run: 'محاسبه',
    running: 'در حال محاسبه…',
    reset: 'بازگشت به وزن‌های ثبت‌شده',
    failed: 'محاسبه انجام نشد. دوباره تلاش کنید.',
    stale: 'راه‌حل‌ها یا معیارها عوض شده‌اند؛ صفحه را تازه کنید.',
    tableCaption: 'امتیاز هر راه‌حل در هر معیار، رتبه و سهم اول شدن',
    solution: 'راه‌حل',
    official: 'امتیاز رسمی',
    whatIf: 'امتیاز این سناریو',
    rank: 'رتبه',
    first: 'سهم اول شدن',
    expected: 'رتبه‌ی مورد انتظار',
    vetoed: 'کنار گذاشته‌شده',
    vetoedWhy: (items: string) => `زیر حداقل: ${items}`,
    dominated: 'مغلوب',
    dominatedBy: (items: string) => `از همه‌ی نظر ضعیف‌تر یا برابر با ${items}`,
    verdictTitle: 'خوانش نتیجه',
    verdicts: {
      confident: (name: string, pct: string) =>
        `«${name}» در ${pct}٪ حالت‌های نمونه‌گیری‌شده اول است؛ نتیجه به وزن‌ها و امتیازها حساس نیست.`,
      leaning: (name: string, pct: string) =>
        `«${name}» در ${pct}٪ حالت‌ها اول است؛ پیشتاز است ولی مطمئن نیست.`,
      open: (name: string, pct: string) =>
        `هیچ راه‌حلی برتری روشن ندارد؛ بهترین، «${name}»، فقط در ${pct}٪ حالت‌ها اول است. پیش از تصمیم، معیارها یا شواهد را روشن‌تر کنید.`,
    },
    caution:
      'این درصدها سهم نمونه‌گیری زیر فرض‌هایی است که همین‌جا انتخاب کرده‌اید؛ احتمال موفقیت راه‌حل نیستند.',
    crossTitle: 'بررسی با روشی دیگر (TOPSIS)',
    cross: {
      agree: 'روش دوم هم همین برنده و ترتیب نزدیک را می‌دهد.',
      differ: 'برنده یکی است ولی ترتیب بقیه با روش دوم فرق می‌کند.',
      split:
        'روش دوم برنده‌ی دیگری می‌دهد؛ یعنی انتخاب به روش محاسبه وابسته است و باید با احتیاط تصمیم بگیرید.',
    },
    flipsTitle: 'چه چیزی باید عوض شود تا برنده عوض شود؟',
    flip: (name: string, criterion: string, from: string, to: string) =>
      `«${name}»: اگر امتیاز «${criterion}» از ${from} به ${to} برسد، تنها برنده می‌شود.`,
    noFlip: (name: string) => `«${name}»: با تغییر یک امتیاز نمی‌تواند برنده شود.`,
    warningsTitle: 'نکته‌هایی درباره‌ی خود مدل',
    warnings: {
      weight_concentrated: (items: string) =>
        `وزن ${items} نیمی از امتیاز را می‌سازد؛ نتیجه عملاً با همین معیار تعیین می‌شود.`,
      too_many_criteria: () => 'معیارها بیش از هفت‌اند؛ وزن‌دادن دقیق دشوار می‌شود.',
      non_discriminating: (items: string) =>
        `${items} بین راه‌حل‌ها فرقی نمی‌گذارد و در انتخاب اثری ندارد.`,
      redundant_criteria: (items: string) =>
        `${items} تقریباً یک چیز را می‌سنجند؛ ممکن است یک اثر دوبار حساب شود.`,
    } as Record<string, (items: string) => string>,
    footer: (iterations: string, seed: string) =>
      `روش: نمونه‌گیری SMAA با ${iterations} نمونه و seed ${seed}؛ با همین ورودی همیشه همین نتیجه را می‌دهد.`,
  },
  en: {
    title: 'Decision matrix',
    intro:
      'This section only explores; it never changes the official score. If you do not know the weights, just order the criteria; Docoo tries thousands of possible weightings and some uncertainty in the scores to see how often each solution comes first.',
    order: 'Order of importance',
    orderHelp: 'Put the most important criterion first.',
    up: 'Move up',
    down: 'Move down',
    weightsFrom: 'Weights',
    modes: {
      free: 'I do not know (any weighting is possible)',
      ordinal: 'I only know the order of importance',
      fixed: 'The saved weights are right',
    } as Record<Mode, string>,
    useRoc: 'Also rank with the weights this order implies',
    spread: 'Uncertainty of the scores',
    spreads: ['Exact', 'Low (±0.5)', 'Medium (±1)', 'High (±1.5)'],
    spreadHelp: 'The weaker the evidence, the more uncertainty you should allow.',
    minimums: 'Must-have minimum (veto)',
    minimumsHelp: 'A solution below this score is set aside whatever else it scores.',
    none: 'No minimum',
    atLeast: 'at least',
    run: 'Calculate',
    running: 'Calculating…',
    reset: 'Back to the saved weights',
    failed: 'The calculation did not run. Try again.',
    stale: 'The solutions or criteria changed; reload the page.',
    tableCaption: 'Score of each solution on each criterion, its rank and how often it comes first',
    solution: 'Solution',
    official: 'Official score',
    whatIf: 'This scenario',
    rank: 'Rank',
    first: 'Share of first place',
    expected: 'Expected rank',
    vetoed: 'Set aside',
    vetoedWhy: (items: string) => `Below the minimum: ${items}`,
    dominated: 'Dominated',
    dominatedBy: (items: string) => `No better than ${items} on any criterion`,
    verdictTitle: 'Reading the result',
    verdicts: {
      confident: (name: string, pct: string) =>
        `“${name}” comes first in ${pct}% of the sampled cases; the result does not depend on the weights or the exact scores.`,
      leaning: (name: string, pct: string) =>
        `“${name}” comes first in ${pct}% of the cases; it leads but it is not certain.`,
      open: (name: string, pct: string) =>
        `No solution has a clear lead; the best, “${name}”, is first in only ${pct}% of the cases. Clarify the criteria or the evidence before deciding.`,
    },
    caution:
      'These percentages are shares of sampling under the assumptions you chose here; they are not the probability that a solution will succeed.',
    crossTitle: 'Second opinion (TOPSIS)',
    cross: {
      agree: 'A second method gives the same winner and a similar order.',
      differ: 'The winner is the same, but the second method orders the rest differently.',
      split:
        'A second method picks another winner, so the choice depends on the method; decide with care.',
    },
    flipsTitle: 'What would have to change for the winner to change?',
    flip: (name: string, criterion: string, from: string, to: string) =>
      `“${name}”: if its “${criterion}” score went from ${from} to ${to}, it would be the only winner.`,
    noFlip: (name: string) => `“${name}”: no single score change could make it win.`,
    warningsTitle: 'About the model itself',
    warnings: {
      weight_concentrated: (items: string) =>
        `${items} carries half of the score, so it practically decides the result.`,
      too_many_criteria: () =>
        'There are more than seven criteria; weighing them precisely gets hard.',
      non_discriminating: (items: string) =>
        `${items} does not tell the solutions apart and has no effect on the choice.`,
      redundant_criteria: (items: string) =>
        `${items} measure almost the same thing; one effect may be counted twice.`,
    } as Record<string, (items: string) => string>,
    footer: (iterations: string, seed: string) =>
      `Method: SMAA sampling with ${iterations} samples and seed ${seed}; the same input always gives the same result.`,
  },
};

/** NXT-002: the what-if decision matrix. Nothing here is saved and the official score never changes. */
export function DecisionMatrixPanel({
  locale,
  base,
  setId,
  criteriaVersionId,
  criteria,
  rows,
}: {
  locale: Locale;
  base: string;
  setId: string;
  criteriaVersionId: string | null;
  criteria: { key: string; label: string; weight: number; enabled: boolean }[];
  rows: Row[];
}) {
  const fa = locale === 'fa';
  const t = words[locale];
  const enabled = useMemo(() => criteria.filter((c) => c.enabled), [criteria]);
  const labels = useMemo(() => new Map(criteria.map((c) => [c.key, c.label])), [criteria]);
  const names = useMemo(() => new Map(rows.map((r) => [r.id, r.title])), [rows]);
  const [order, setOrder] = useState(() => initialOrder(criteria));
  const [mode, setMode] = useState<Mode>('free');
  const [useRoc, setUseRoc] = useState(false);
  const [spread, setSpread] = useState(0);
  const [minimums, setMinimums] = useState<Record<string, number>>({});
  const [result, setResult] = useState<DecisionMatrixResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'failed' | 'stale' | null>(null);
  const name = (id: string) => names.get(id) ?? id;
  const label = (key: string) => labels.get(key) ?? key;
  const list = (keys: string[]) => keys.map(label).join(fa ? '، ' : ', ');
  const num = (value: number) => formatNumber(locale, value);

  const run = useCallback(
    async (overrides?: Partial<{ order: string[]; mode: Mode; useRoc: boolean }>) => {
      const current = { order, mode, useRoc, ...overrides };
      setBusy(true);
      setProblem(null);
      try {
        const kept = Object.fromEntries(Object.entries(minimums).filter(([, value]) => value >= 2));
        const { decisionMatrix } = await apiSend<{ decisionMatrix: DecisionMatrixResult }>(
          'POST',
          `${base}/solutions/decision-matrix`,
          {
            mode: current.mode,
            weightOrder: current.order,
            applyRoc: current.useRoc,
            scoreSpread: spread,
            ...(Object.keys(kept).length > 0 ? { minimums: kept } : {}),
          },
        );
        if (
          decisionMatrix.setId !== setId ||
          decisionMatrix.criteriaVersionId !== criteriaVersionId
        )
          throw new Error('stale');
        setResult(decisionMatrix);
      } catch (error) {
        setResult(null);
        setProblem(error instanceof Error && error.message === 'stale' ? 'stale' : 'failed');
      } finally {
        setBusy(false);
      }
    },
    [base, criteriaVersionId, minimums, mode, order, setId, spread, useRoc],
  );

  // The first answer comes as the panel opens, with nothing assumed.
  useEffect(() => {
    void run();
  }, []);

  const matrix = result?.matrix ?? null;
  const smaaById = new Map(matrix?.smaa?.alternatives.map((a) => [a.id, a]) ?? []);
  const vetoedById = new Map(matrix?.vetoed.map((v) => [v.id, v]) ?? []);
  const dominatedById = new Map(matrix?.dominated.map((d) => [d.id, d]) ?? []);
  const officialById = new Map(matrix?.officialRanking.map((r) => [r.id, r]) ?? []);
  const rankById = new Map(matrix?.ranking.map((r) => [r.id, r]) ?? []);
  const leader = matrix?.smaa?.leaderId ?? null;
  const agreement = matrix
    ? agreementLevel(matrix.crossCheck.tau, matrix.crossCheck.sameWinner)
    : null;
  const ordered = matrix
    ? [...rows].sort((a, b) => (rankById.get(a.id)?.rank ?? 99) - (rankById.get(b.id)?.rank ?? 99))
    : rows;

  return (
    <section className="card stack" aria-labelledby="decision-matrix-title">
      <h2 id="decision-matrix-title">{t.title}</h2>
      <p className="muted">{t.intro}</p>

      <div className="stack">
        <h3>{t.order}</h3>
        <p className="muted">{t.orderHelp}</p>
        <ol className="output-list">
          {order.map((key, index) => (
            <li key={key} dir={textDir(locale)}>
              {label(key)}{' '}
              <button
                type="button"
                className="ghost-button"
                aria-label={`${t.up}: ${label(key)}`}
                disabled={index === 0 || busy}
                onClick={() => setOrder(moveKey(order, key, -1))}
              >
                ↑
              </button>{' '}
              <button
                type="button"
                className="ghost-button"
                aria-label={`${t.down}: ${label(key)}`}
                disabled={index === order.length - 1 || busy}
                onClick={() => setOrder(moveKey(order, key, 1))}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        <div className="field">
          <label htmlFor="matrix-mode">{t.weightsFrom}</label>
          <select
            id="matrix-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
          >
            {(['free', 'ordinal', 'fixed'] as const).map((value) => (
              <option key={value} value={value}>
                {t.modes[value]}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={useRoc}
            onChange={(event) => setUseRoc(event.target.checked)}
          />{' '}
          {t.useRoc}
        </label>
        <div className="field">
          <label htmlFor="matrix-spread">{t.spread}</label>
          <select
            id="matrix-spread"
            value={spread}
            onChange={(event) => setSpread(Number(event.target.value))}
          >
            {SPREADS.map((value, index) => (
              <option key={value} value={value}>
                {t.spreads[index]}
              </option>
            ))}
          </select>
          <p className="muted">{t.spreadHelp}</p>
        </div>
        <fieldset className="stack">
          <legend>{t.minimums}</legend>
          <p className="muted">{t.minimumsHelp}</p>
          {enabled.map((c) => (
            <div className="field" key={c.key}>
              <label htmlFor={`matrix-min-${c.key}`}>{c.label}</label>
              <select
                id={`matrix-min-${c.key}`}
                value={minimums[c.key] ?? 0}
                onChange={(event) =>
                  setMinimums((previous) => ({ ...previous, [c.key]: Number(event.target.value) }))
                }
              >
                <option value={0}>{t.none}</option>
                {[2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {t.atLeast} {num(value)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
        <div className="toolbar">
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? t.running : t.run}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => {
              const start = initialOrder(criteria);
              setOrder(start);
              setMode('free');
              setUseRoc(false);
              setSpread(0);
              setMinimums({});
              void run({ order: start, mode: 'free', useRoc: false });
            }}
          >
            {t.reset}
          </button>
        </div>
      </div>

      {problem && (
        <p className="notice error" role="alert">
          {problem === 'stale' ? t.stale : t.failed}
        </p>
      )}

      {matrix && (
        <>
          {matrix.smaa && leader && (
            <div role="status" className="stack">
              <h3>{t.verdictTitle}</h3>
              <p>
                <span
                  className={`badge ${
                    matrix.smaa.verdict === 'confident'
                      ? 'state-passed'
                      : matrix.smaa.verdict === 'leaning'
                        ? 'state-paused'
                        : 'state-failed'
                  }`}
                >
                  {num(sharePercent(matrix.smaa.leaderShare))}٪
                </span>{' '}
                {t.verdicts[matrix.smaa.verdict](
                  name(leader),
                  num(sharePercent(matrix.smaa.leaderShare)),
                )}
              </p>
              <p className="muted">{t.caution}</p>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <caption className="sr-only">{t.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.solution}</th>
                  {matrix.criteria
                    .filter((c) => c.enabled)
                    .map((c) => (
                      <th scope="col" key={c.key}>
                        {c.label} ({num(c.weight)}٪)
                      </th>
                    ))}
                  <th scope="col">{t.official}</th>
                  <th scope="col">{t.whatIf}</th>
                  <th scope="col">{t.rank}</th>
                  <th scope="col">{t.first}</th>
                  <th scope="col">{t.expected}</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => {
                  const veto = vetoedById.get(row.id);
                  const dominated = dominatedById.get(row.id);
                  const smaaRow = smaaById.get(row.id);
                  return (
                    <tr key={row.id}>
                      <th scope="row" dir={textDir(locale)}>
                        {name(row.id)}
                        {veto && (
                          <>
                            <br />
                            <span className="badge state-failed">{t.vetoed}</span>{' '}
                            <small>
                              {t.vetoedWhy(
                                veto.failed
                                  .map(
                                    (f) =>
                                      `${label(f.criterionKey)} ${num(f.raw)}<${num(f.minimum)}`,
                                  )
                                  .join(fa ? '، ' : ', '),
                              )}
                            </small>
                          </>
                        )}
                        {dominated && (
                          <>
                            <br />
                            <span className="badge state-pending">{t.dominated}</span>{' '}
                            <small>
                              {t.dominatedBy(
                                dominated.dominatedBy.map(name).join(fa ? '، ' : ', '),
                              )}
                            </small>
                          </>
                        )}
                      </th>
                      {matrix.criteria
                        .filter((c) => c.enabled)
                        .map((c) => (
                          <td key={c.key}>{num(row.raw[c.key] ?? 1)}</td>
                        ))}
                      <td>{num(officialById.get(row.id)?.total ?? 0)}</td>
                      <td>{veto ? '—' : num(rankById.get(row.id)?.total ?? 0)}</td>
                      <td>{veto ? '—' : num(rankById.get(row.id)?.rank ?? 0)}</td>
                      <td>
                        {smaaRow ? (
                          <>
                            <progress
                              max={100}
                              value={sharePercent(smaaRow.firstShare)}
                              aria-label={`${t.first}: ${name(row.id)}`}
                            />{' '}
                            {num(sharePercent(smaaRow.firstShare))}٪
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{smaaRow ? num(Math.round(smaaRow.expectedRank * 10) / 10) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {agreement && (
            <div className="stack">
              <h3>{t.crossTitle}</h3>
              <p className={agreement === 'split' ? 'notice warn' : undefined}>
                {t.cross[agreement]}
              </p>
            </div>
          )}

          {matrix.flips.length > 0 && (
            <div className="stack">
              <h3>{t.flipsTitle}</h3>
              <ul className="output-list">
                {matrix.flips.map((flip) => (
                  <li key={flip.id} dir={textDir(locale)}>
                    {flip.change
                      ? t.flip(
                          name(flip.id),
                          label(flip.change.criterionKey),
                          num(flip.change.from),
                          num(flip.change.to),
                        )
                      : t.noFlip(name(flip.id))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {matrix.warnings.length > 0 && (
            <div className="stack">
              <h3>{t.warningsTitle}</h3>
              <ul className="output-list">
                {matrix.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`} dir={textDir(locale)}>
                    {t.warnings[warning.code]?.(list(warning.criterionKeys)) ?? warning.code}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {matrix.smaa && (
            <p className="muted">
              <small>{t.footer(num(matrix.smaa.iterations), num(matrix.smaa.seed))}</small>
            </p>
          )}
        </>
      )}
    </section>
  );
}
