'use client';

import { useEffect, useState } from 'react';

import type { LiveCostReport } from '@docoo/contracts';

import { ApiError } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { liveReadApi } from '../../live-assistant/live-api';
import { SectionTitle } from '../../info-tip';
import { TilesSkeleton } from '../../skeleton';
import { voiceCostMessagesFor, type VoiceCostMessages } from './voice-cost-messages';

const DAYS = [7, 30, 90] as const;

const BRANDS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  xai: 'xAI',
};

/** A provider as people know it; an empty one (a typed session) has none. */
export function providerLabel(provider: string, text: VoiceCostMessages): string {
  if (provider === '') return text.typedOnly;
  return BRANDS[provider] ?? provider;
}

/** Cost per session and the share of the cost that went to the voice provider. */
export function costFigures(group: LiveCostReport['groups'][number]): {
  total: number;
  perSession: number;
  voiceShare: number;
} {
  const total = group.voiceCostUsd + group.typedCostUsd;
  return {
    total,
    perSession: group.sessions > 0 ? total / group.sessions : 0,
    voiceShare: total > 0 ? group.voiceCostUsd / total : 0,
  };
}

/** What the assistant's conversations cost, by provider and by day (the person's own, like the Smart tab). */
export function VoiceAssistantCost({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const text = voiceCostMessagesFor(locale);
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [report, setReport] = useState<LiveCostReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError('');
    liveReadApi
      .costReport(workspaceId, days, controller.signal)
      .then(setReport)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status === 403 ? text.forbidden : text.failed);
      });
    return () => controller.abort();
  }, [workspaceId, days, text.forbidden, text.failed]);

  const money = (value: number) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 4,
    }).format(value);
  const percent = (value: number) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(value);

  const totalCost = report
    ? report.groups.reduce((sum, group) => sum + group.voiceCostUsd + group.typedCostUsd, 0)
    : 0;
  const totalSessions = report ? report.groups.reduce((sum, group) => sum + group.sessions, 0) : 0;
  const busiest = report
    ? report.byDay.reduce(
        (top, day) =>
          day.voiceCostUsd + day.typedCostUsd > top.voiceCostUsd + top.typedCostUsd ? day : top,
        report.byDay[0] ?? { day: '', sessions: 0, voiceCostUsd: 0, typedCostUsd: 0 },
      )
    : null;

  return (
    <div className="stack">
      <section className="card" aria-labelledby="voice-assistant-cost-title">
        <SectionTitle id="voice-assistant-cost-title" help={text.help}>
          {text.title}
        </SectionTitle>
        <div className="field">
          <label htmlFor="voice-assistant-days">{text.period}</label>
          <select
            id="voice-assistant-days"
            value={days}
            onChange={(event) => setDays(Number(event.target.value) as (typeof DAYS)[number])}
          >
            {DAYS.map((value) => (
              <option key={value} value={value}>
                {text.lastDays.replace('{n}', formatNumber(locale, value))}
              </option>
            ))}
          </select>
        </div>
        {error !== '' && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {error === '' && report === null && <TilesSkeleton label={text.loading} />}
        {report !== null && totalSessions === 0 && <p className="muted">{text.none}</p>}
        {report !== null && totalSessions > 0 && (
          <>
            <ul className="tiles" aria-label={text.summary}>
              <li>
                <span className="muted">{text.total}</span> <strong>{money(totalCost)}</strong>
              </li>
              <li>
                <span className="muted">{text.sessions}</span>{' '}
                <strong>{formatNumber(locale, totalSessions)}</strong>
              </li>
              <li>
                <span className="muted">{text.perSession}</span>{' '}
                <strong>{money(totalCost / totalSessions)}</strong>
              </li>
              {report.dailyCapUsd > 0 && (
                <li>
                  <span className="muted">{text.dailyCap}</span>{' '}
                  <strong>{money(report.dailyCapUsd)}</strong>
                </li>
              )}
            </ul>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={text.byProvider}>
              <table>
                <caption className="sr-only">{text.byProvider}</caption>
                <thead>
                  <tr>
                    <th scope="col">{text.provider}</th>
                    <th scope="col">{text.kind}</th>
                    <th scope="col">{text.model}</th>
                    <th scope="col">{text.sessions}</th>
                    <th scope="col">{text.minutes}</th>
                    <th scope="col">{text.voiceCost}</th>
                    <th scope="col">{text.typedCost}</th>
                    <th scope="col">{text.total}</th>
                    <th scope="col">{text.perSession}</th>
                    <th scope="col">{text.voiceShare}</th>
                    <th scope="col">{text.tokens}</th>
                    <th scope="col">{text.cached}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((group) => {
                    const figures = costFigures(group);
                    return (
                      <tr key={`${group.provider}|${group.mode}|${group.model}`}>
                        <th scope="row">{providerLabel(group.provider, text)}</th>
                        <td>{text.kinds[group.mode]}</td>
                        <td dir="ltr">{group.model === '' ? '—' : group.model}</td>
                        <td>{formatNumber(locale, group.sessions)}</td>
                        <td>{formatNumber(locale, Math.round(group.minutes))}</td>
                        <td>{money(group.voiceCostUsd)}</td>
                        <td>{money(group.typedCostUsd)}</td>
                        <td>{money(figures.total)}</td>
                        <td>{money(figures.perSession)}</td>
                        <td>{percent(figures.voiceShare)}</td>
                        <td>{formatNumber(locale, group.tokens)}</td>
                        <td>{formatNumber(locale, group.cachedInputTokens)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted">{text.minutesNote}</p>
            {busiest !== null && busiest.day !== '' && (
              <p className="muted">
                {text.busiest
                  .replace('{day}', busiest.day)
                  .replace('{cost}', money(busiest.voiceCostUsd + busiest.typedCostUsd))}
              </p>
            )}
            <div className="table-scroll" tabIndex={0} role="region" aria-label={text.byDay}>
              <table>
                <caption className="sr-only">{text.byDay}</caption>
                <thead>
                  <tr>
                    <th scope="col">{text.day}</th>
                    <th scope="col">{text.sessions}</th>
                    <th scope="col">{text.voiceCost}</th>
                    <th scope="col">{text.typedCost}</th>
                    <th scope="col">{text.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byDay.map((row) => (
                    <tr key={row.day}>
                      <th scope="row" dir="ltr">
                        {row.day}
                      </th>
                      <td>{formatNumber(locale, row.sessions)}</td>
                      <td>{money(row.voiceCostUsd)}</td>
                      <td>{money(row.typedCostUsd)}</td>
                      <td>{money(row.voiceCostUsd + row.typedCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
