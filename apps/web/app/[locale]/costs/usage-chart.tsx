'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { apiGet, query } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { reportMessagesFor } from '../../report-messages';
import { SectionTitle } from '../../info-tip';
import { TilesSkeleton } from '../../skeleton';
import {
  CHART,
  USAGE_SOURCES,
  colourSlot,
  dayTickIndexes,
  linePath,
  nearestIndex,
  niceTicks,
  shortDay,
  visibleLines,
  xAt,
  yAt,
  type UsageSource,
} from './usage-chart-model';

const PERIODS = [7, 30, 90] as const;

interface Series {
  days: string[];
  series: { key: string; points: number[] }[];
  totalTokens: number;
  options: { stages: string[]; projects: { id: string; title: string }[] };
}

/** Tokens per day, filtered by project, stage and source, optionally one line per source. */
export function UsageChart({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = reportMessagesFor(locale).costs.chart;
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [projectId, setProjectId] = useState('');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState<'' | UsageSource>('');
  const [split, setSplit] = useState<'none' | 'source'>('source');
  const [data, setData] = useState<Series | null>(null);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    const to = new Date();
    const from = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (days - 1)),
    );
    apiGet<{ series: Series }>(
      `/workspaces/${workspaceId}/reports/usage-series${query({
        from: from.toISOString(),
        to: to.toISOString(),
        projectId,
        stage,
        source,
        splitBy: split,
      })}`,
      controller.signal,
    )
      .then((result) => {
        setData(result.series);
        setHover(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [workspaceId, days, projectId, stage, source, split]);

  const number = (value: number) => formatNumber(locale, Math.round(value));
  const compact = (value: number) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      notation: value >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value);
  const label = (key: string) =>
    (text.sources as Record<string, string>)[key] ?? (key === 'all' ? text.tokens : key);

  const lines = data ? visibleLines(data.series) : [];
  const length = data?.days.length ?? 0;
  const peak = Math.max(0, ...lines.flatMap((line) => line.points));
  const { top, ticks } = niceTicks(peak);
  const legend = lines.length > 1;

  function moveTo(event: PointerEvent<SVGSVGElement>) {
    const box = svg.current?.getBoundingClientRect();
    if (!box || length === 0) return;
    setHover(nearestIndex(((event.clientX - box.left) / box.width) * CHART.width, length));
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (length === 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -length, End: length }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    // The time axis always runs left to right, so the arrows follow the screen, not the language.
    setHover((current) => Math.min(length - 1, Math.max(0, (current ?? 0) + step)));
  }

  return (
    <section className="card stack usage-chart" aria-labelledby={`${id}-title`}>
      <SectionTitle id={`${id}-title`} help={text.help}>
        {text.title}
      </SectionTitle>
      <div className="filter-grid filters-row">
        <div className="field">
          <label htmlFor={`${id}-period`}>{text.period}</label>
          <select
            id={`${id}-period`}
            value={days}
            onChange={(event) => setDays(Number(event.target.value) as (typeof PERIODS)[number])}
          >
            {PERIODS.map((value) => (
              <option key={value} value={value}>
                {fill(text.lastDays, { n: formatNumber(locale, value) })}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-project`}>{text.project}</label>
          <select
            id={`${id}-project`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{text.all}</option>
            {(data?.options.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-stage`}>{text.stage}</label>
          <select
            id={`${id}-stage`}
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            dir="ltr"
          >
            <option value="">{text.all}</option>
            {(data?.options.stages ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-source`}>{text.source}</label>
          <select
            id={`${id}-source`}
            value={source}
            onChange={(e) => setSource(e.target.value as '' | UsageSource)}
          >
            <option value="">{text.all}</option>
            {USAGE_SOURCES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-split`}>{text.splitBy}</label>
          <select
            id={`${id}-split`}
            value={split}
            onChange={(e) => setSplit(e.target.value as 'none' | 'source')}
          >
            <option value="source">{text.bySource}</option>
            <option value="none">{text.noSplit}</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="notice error" role="alert">
          {text.failed}
        </p>
      )}
      {!error && data === null && <TilesSkeleton label={reportMessagesFor(locale).loading} />}
      {data !== null && data.totalTokens === 0 && <p className="muted">{text.none}</p>}
      {data !== null && data.totalTokens > 0 && (
        <>
          <p className="muted">
            {text.total}: <strong>{number(data.totalTokens)}</strong> {text.tokens}
          </p>
          {legend && (
            <ul className="legend" aria-label={text.splitBy}>
              {lines.map((line) => (
                <li key={line.key}>
                  <span
                    className="key"
                    style={{ background: `var(--series-${colourSlot(line.key)})` }}
                  />
                  {label(line.key)}
                </li>
              ))}
            </ul>
          )}
          {/* Time runs left to right in every language, so the chart is always LTR. */}
          <div dir="ltr">
            <svg
              ref={svg}
              viewBox={`0 0 ${CHART.width} ${CHART.height}`}
              role="img"
              aria-label={text.aria}
              tabIndex={0}
              onPointerMove={moveTo}
              onPointerLeave={() => setHover(null)}
              onKeyDown={key}
              onBlur={() => setHover(null)}
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    className="grid"
                    x1={CHART.left}
                    x2={CHART.width - CHART.right}
                    y1={yAt(tick, top)}
                    y2={yAt(tick, top)}
                  />
                  <text className="tick" x={CHART.left - 8} y={yAt(tick, top) + 4} textAnchor="end">
                    {compact(tick)}
                  </text>
                </g>
              ))}
              {dayTickIndexes(length).map((index) => (
                <text
                  key={index}
                  className="tick"
                  x={xAt(index, length)}
                  y={CHART.height - 8}
                  textAnchor={index === 0 ? 'start' : index === length - 1 ? 'end' : 'middle'}
                >
                  {shortDay(data.days[index]!)}
                </text>
              ))}
              {lines.map((line) => (
                <path
                  key={line.key}
                  className="line"
                  d={linePath(line.points, top)}
                  style={{ stroke: `var(--series-${colourSlot(line.key)})` }}
                />
              ))}
              {hover !== null && (
                <>
                  <line
                    className="crosshair"
                    x1={xAt(hover, length)}
                    x2={xAt(hover, length)}
                    y1={CHART.top}
                    y2={CHART.height - CHART.bottom}
                  />
                  {lines.map((line) => (
                    <circle
                      key={line.key}
                      className="dot"
                      cx={xAt(hover, length)}
                      cy={yAt(line.points[hover] ?? 0, top)}
                      r={4}
                      style={{ fill: `var(--series-${colourSlot(line.key)})` }}
                    />
                  ))}
                </>
              )}
            </svg>
            {hover !== null && (
              <div
                className="tooltip"
                role="status"
                style={{
                  insetInlineStart: `${(xAt(hover, length) / CHART.width) * 100}%`,
                  transform:
                    hover > length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
                }}
              >
                <strong dir="ltr">{data.days[hover]}</strong>
                <dl>
                  {lines.map((line) => (
                    <div key={line.key} style={{ display: 'contents' }}>
                      <dt>{legend ? label(line.key) : text.tokens}</dt>
                      <dd>{number(line.points[hover] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowTable((value) => !value)}
              aria-expanded={showTable}
            >
              {text.table}
            </button>
          </div>
          {showTable && (
            <div className="table-scroll" tabIndex={0} role="region" aria-label={text.title}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{text.day}</th>
                    {lines.map((line) => (
                      <th key={line.key} scope="col">
                        {legend ? label(line.key) : text.tokens}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((day, index) => (
                    <tr key={day}>
                      <th scope="row" dir="ltr">
                        {day}
                      </th>
                      {lines.map((line) => (
                        <td key={line.key}>{number(line.points[index] ?? 0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
