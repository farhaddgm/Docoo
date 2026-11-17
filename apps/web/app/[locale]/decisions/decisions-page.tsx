'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatNumber, textDir, type Locale } from '../../i18n';
import {
  assessPortfolio,
  QUALITY_AXES,
  type Attention,
  type AttentionReason,
  type DecisionFacts,
  type DecisionRow,
  type QualityAxis,
  type StabilityKind,
  type Thresholds,
} from '../projects/[projectId]/decision-portfolio';
import { stabilityVerdict, type StabilityResult } from '../projects/[projectId]/criteria-weights';
import type { WorkflowFacts } from '../projects/[projectId]/project-health';
import { healthMessages } from '../projects/[projectId]/health-messages';
import { WorkspacePage } from '../workspace-page';

/** At most this many decisions are read at once; the portfolio is for a small back office. */
const MAX_PROJECTS = 60;
const PARALLEL = 4;

const words = {
  fa: {
    title: 'سبد تصمیم‌ها',
    subtitle: 'سلامت خود تصمیم‌ها، نه فقط کارِ منتهی به آن‌ها',
    loading: 'در حال خواندن تصمیم‌ها…',
    failed: 'خواندن تصمیم‌ها انجام نشد. دوباره تلاش کنید.',
    empty: 'تصمیم در جریانی نیست.',
    truncated: (n: string) => `فقط ${n} پروژه‌ی نخست خوانده شد.`,
    thresholds: (warn: string, stale: string, source: Thresholds['source']) =>
      source === 'history'
        ? `انتظار طولانی یعنی بیش از ${warn} روز (بر اساس انتظار تصمیم‌های خودتان) و فوری بعد از ${stale} روز.`
        : `هنوز تصمیم کافی برای یادگیری زمان عادی نیست؛ پیش‌فرض: ${warn} روز برای توجه و ${stale} روز برای فوری.`,
    columns: ['تصمیم', 'وضعیت', 'نیاز به توجه', 'سن', 'کیفیت', 'ضعیف‌ترین بخش'],
    attention: { urgent: 'فوری', soon: 'به‌زودی', ok: 'عادی', done: 'تمام' } as Record<
      Attention,
      string
    >,
    reasons: {
      blocked: 'کار متوقف است و بدون رفع مشکل جلو نمی‌رود.',
      waiting_long: 'مدت زیادی منتظر شماست.',
      waiting: 'منتظر شماست.',
      undecided_long: 'راه‌حل‌ها آماده‌اند ولی مدت‌هاست انتخابی ثبت نشده.',
      undecided: 'راه‌حل‌ها آماده‌اند و منتظر انتخاب‌اند.',
      weak_axis: 'یکی از ارکان کیفیت تصمیم هنوز خالی است.',
      idle: 'هنوز اجرایی ندارد.',
    } as Record<AttentionReason, string>,
    axes: {
      frame: 'چارچوب (تعریف مسئله)',
      alternatives: 'گزینه‌ها',
      information: 'اطلاعات (شواهد)',
      values: 'ارزش‌ها (وزن معیارها)',
      reasoning: 'استدلال (سند و ارزیابی)',
      commitment: 'تعهد (انتخاب ثبت‌شده)',
    } as Record<QualityAxis, string>,
    none: '—',
    days: 'روز',
    open: 'باز کردن',
    note: 'کیفیت از شش رکن تصمیم خوب ساخته می‌شود (چارچوب، گزینه‌ها، اطلاعات، ارزش‌ها، استدلال، تعهد) و فقط از واقعیت‌هایی که سامانه دارد؛ نمرهٔ درستی تصمیم نیست. اثر تغییر دانش و فرض‌های منقضی‌شونده هنوز اندازه‌گیری نمی‌شوند.',
  },
  en: {
    title: 'Decision portfolio',
    subtitle: 'The health of the decisions themselves, not only of the work that leads to them',
    loading: 'Reading the decisions…',
    failed: 'The decisions could not be read. Try again.',
    empty: 'No decision is in progress.',
    truncated: (n: string) => `Only the first ${n} projects were read.`,
    thresholds: (warn: string, stale: string, source: Thresholds['source']) =>
      source === 'history'
        ? `A long wait is more than ${warn} days (from your own decisions’ waits); urgent after ${stale} days.`
        : `Too few decisions to learn a normal wait yet; defaults: ${warn} days to look, ${stale} days for urgent.`,
    columns: ['Decision', 'State', 'Attention', 'Age', 'Quality', 'Weakest part'],
    attention: { urgent: 'Urgent', soon: 'Soon', ok: 'Normal', done: 'Done' } as Record<
      Attention,
      string
    >,
    reasons: {
      blocked: 'The work is stopped and will not go on until something is fixed.',
      waiting_long: 'It has waited for you a long time.',
      waiting: 'It is waiting for you.',
      undecided_long: 'The solutions are ready but nothing has been chosen for a long time.',
      undecided: 'The solutions are ready and wait for a choice.',
      weak_axis: 'One element of decision quality is still empty.',
      idle: 'It has not run yet.',
    } as Record<AttentionReason, string>,
    axes: {
      frame: 'Frame (problem definition)',
      alternatives: 'Alternatives',
      information: 'Information (evidence)',
      values: 'Values (criteria weights)',
      reasoning: 'Reasoning (document and evaluation)',
      commitment: 'Commitment (recorded choice)',
    } as Record<QualityAxis, string>,
    none: '—',
    days: 'days',
    open: 'Open',
    note: 'Quality is built from the six elements of a good decision (frame, alternatives, information, values, reasoning, commitment) and only from facts the system has; it is not a score of whether the decision is right. The effect of changed knowledge and of expiring assumptions is not measured yet.',
  },
};

const badge: Record<Attention, string> = {
  urgent: 'state-failed',
  soon: 'state-paused',
  ok: 'state-active',
  done: 'state-completed',
};

interface ProjectItem {
  id: string;
  code: string;
  title: string;
  status: string;
  updatedAt: string;
}

async function loadFacts(base: string, project: ProjectItem): Promise<DecisionFacts> {
  const [workflow, set, journal] = await Promise.all([
    apiGet<{ workflow: WorkflowFacts }>(`${base}/projects/${project.id}/workflow`).catch(
      () => null,
    ),
    apiGet<{
      solutionSet: {
        items: unknown[];
        criteria: { criteria: { key: string; weight: number; enabled: boolean }[] };
      };
    }>(`${base}/projects/${project.id}/solutions`).catch(() => null),
    apiGet<{ decisions: { recordedAt: string }[] }>(
      `${base}/projects/${project.id}/solution-decisions`,
    ).catch(() => null),
  ]);
  const solutionCount = set?.solutionSet.items.length ?? 0;
  let stability: StabilityKind = null;
  if (solutionCount >= 2) {
    try {
      const criterion = set?.solutionSet.criteria.criteria.find((c) => c.enabled);
      if (criterion) {
        const { sensitivity } = await apiSend<{ sensitivity: { stability: StabilityResult } }>(
          'POST',
          `${base}/projects/${project.id}/solutions/sensitivity`,
          { criterionKey: criterion.key, weight: criterion.weight },
        );
        stability = stabilityVerdict(sensitivity.stability).kind;
      }
    } catch {
      stability = null;
    }
  }
  const dates = (journal?.decisions ?? []).map((d) => d.recordedAt).sort();
  return {
    project,
    workflow: workflow?.workflow ?? null,
    solutionCount,
    decided: dates.length > 0,
    lastDecisionAt: dates.at(-1) ?? null,
    stability,
  };
}

/** Runs the loaders a few at a time so a long list does not open sixty connections at once. */
async function inPool<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index] as T);
      }
    }),
  );
  return results;
}

function Portfolio({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const t = words[locale];
  const health = healthMessages(locale);
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'ready'; rows: DecisionRow[]; thresholds: Thresholds; truncated: boolean }
  >({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    const base = `/workspaces/${workspaceId}`;
    (async () => {
      const lists = await Promise.all(
        (['active', 'paused'] as const).map((status) =>
          apiGet<{ items: ProjectItem[] }>(`${base}/projects?status=${status}&limit=50`),
        ),
      );
      const all = lists.flatMap((l) => l.items);
      const projects = all.slice(0, MAX_PROJECTS);
      const facts = await inPool(projects, (p) => loadFacts(base, p));
      if (!live) return;
      const { rows, thresholds } = assessPortfolio(facts, new Date());
      setState({ kind: 'ready', rows, thresholds, truncated: all.length > MAX_PROJECTS });
    })().catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  if (state.kind === 'loading')
    return (
      <p className="muted" role="status">
        {t.loading}
      </p>
    );
  if (state.kind === 'failed')
    return (
      <p className="notice error" role="alert">
        {t.failed}
      </p>
    );
  const num = (n: number) => formatNumber(locale, n);
  return (
    <section className="card stack">
      <p className="muted">
        {t.thresholds(
          num(state.thresholds.warnDays),
          num(state.thresholds.staleDays),
          state.thresholds.source,
        )}
      </p>
      {state.truncated && <p className="notice warn">{t.truncated(num(MAX_PROJECTS))}</p>}
      {state.rows.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {t.columns.map((c) => (
                  <th scope="col" key={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" dir={textDir(locale)}>
                    <Link href={`/${locale}/projects/${row.id}` as Route}>
                      {row.code} · {row.title}
                    </Link>
                    {row.reasons.length > 0 && (
                      <ul className="output-list">
                        {row.reasons.map((reason) => (
                          <li key={reason}>
                            <small>{t.reasons[reason]}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </th>
                  <td>{health.levels[row.health.level] ?? row.health.level}</td>
                  <td>
                    <span className={`badge ${badge[row.attention]}`}>
                      {t.attention[row.attention]}
                    </span>
                  </td>
                  <td>
                    {num(row.ageDays)} {t.days}
                  </td>
                  <td>
                    <progress max={100} value={row.quality.score} aria-label={t.columns[4]} />{' '}
                    {num(row.quality.score)}٪
                  </td>
                  <td>{row.quality.weakest ? t.axes[row.quality.weakest] : t.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        <small>{t.note}</small>
      </p>
      <details>
        <summary>{t.columns[4]}</summary>
        <ul className="output-list">
          {QUALITY_AXES.map((axis) => (
            <li key={axis}>{t.axes[axis]}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function DecisionsPage({ locale }: { locale: Locale }) {
  const t = words[locale];
  return (
    <WorkspacePage locale={locale} title={t.title} subtitle={t.subtitle}>
      {(workspaceId) => <Portfolio locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}
