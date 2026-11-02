'use client';

import { Fragment, useCallback, useEffect, useId, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

export type RequirementKind = 'must' | 'must_not';
type Verdict = 'covered' | 'partial' | 'not_covered' | 'unknown';

export interface Requirement {
  id: string;
  kind: RequirementKind;
  text: string;
  source: 'admin' | 'chat';
  stage: string | null;
  /** The stage it binds; null: the final output as a whole. */
  target: string | null;
  createdAt: string;
  behindStages: string[];
}

/** The scopes a requirement can be written for: the final output, then each stage in order. */
export const REQUIREMENT_SCOPES = [
  'final',
  'analysis',
  'research',
  'ideation',
  'documentation',
  'evaluation',
] as const;
export type RequirementScope = (typeof REQUIREMENT_SCOPES)[number];
const scopeOf = (item: { target: string | null }): RequirementScope =>
  (item.target as RequirementScope | null) ?? 'final';

interface HistoryItem extends Requirement {
  endedKind: 'withdrawn' | 'replaced';
  endedReason: string;
  endedAt: string;
}

interface CheckLine {
  requirementId: string;
  kind: RequirementKind;
  text: string;
  target?: string | null;
  verdict: Verdict;
  evidence: string;
  foundIn: string;
}

interface Check {
  checkId: string;
  at: string;
  stale: boolean;
  summary: { total: number; covered: number; partial: number; notCovered: number; unknown: number };
  results: CheckLine[];
}

export interface RequirementsData {
  items: Requirement[];
  history: HistoryItem[];
  limit: number;
  textMax: number;
  stages: { stage: string; outputCreatedAt: string | null }[];
  check: Check | null;
}

const copy = {
  fa: {
    title: 'الزامات خروجی',
    help: 'هر وقت به ذهنتان رسید که خروجی چه چیزهایی باید داشته باشد یا نباید داشته باشد، همین‌جا بنویسید؛ یا برای کل خروجی نهایی، یا فقط برای یک مرحله (از تحلیل تا ارزیابی). در پایان می‌توانید بسنجید خروجی کدام را پوشش داده است. می‌توانید هر پیام گفتگو با ایجنت را هم از همان‌جا به این فهرست اضافه کنید.',
    scopesLabel: 'الزامات به تفکیک مرحله',
    scopes: {
      final: 'کل خروجی',
      analysis: 'تحلیل',
      research: 'تحقیق',
      ideation: 'ایده',
      documentation: 'مستند',
      evaluation: 'ارزیابی',
    } as Record<string, string>,
    scopeHelp: {
      final:
        'الزام‌هایی که برای خروجی نهایی پروژه‌اند. ایجنت همه مرحله‌ها آن‌ها را می‌خوانند و هر کدام در حد کار خودش رعایتشان می‌کند.',
      analysis: 'فقط ایجنت «تحلیل» این‌ها را می‌خواند؛ مثلا پرسش‌هایی که حتما باید پرسیده شود.',
      research:
        'فقط ایجنت «تحقیق» این‌ها را می‌خواند؛ مثلا منبع‌هایی که باید یا نباید استفاده شود.',
      ideation: 'فقط ایجنت «ایده» این‌ها را می‌خواند؛ مثلا محدودیت بودجه یا نوع راه‌حل‌ها.',
      documentation: 'فقط نگارنده «مستند» و ارزیاب سند این‌ها را می‌خوانند؛ مثلا بخش‌ها و لحن سند.',
      evaluation: 'فقط ایجنت «ارزیابی» این‌ها را می‌خواند؛ مثلا معیارهایی که حتما سنجیده شود.',
    } as Record<string, string>,
    emptyScope: 'برای این بخش هنوز الزامی ثبت نشده است.',
    appliesTo: 'مربوط به',
    appliesToStage: 'مخصوص «{stage}»',
    kind: 'نوع',
    kinds: { must: 'باید داشته باشد', must_not: 'نباید داشته باشد' },
    text: 'متن الزام',
    placeholder: 'مثلا: بخش «ریسک‌ها» با مسئول هر ریسک',
    add: 'افزودن الزام',
    adding: 'در حال ثبت…',
    empty: 'هنوز الزامی ثبت نشده است.',
    count: '{n} از {limit} الزام فعال',
    sources: { admin: 'نوشته شما', chat: 'از گفتگو با ایجنت' },
    addedAt: 'ثبت در {at}',
    inStage: 'هنگام کار روی «{stage}»',
    behind:
      'این الزام بعد از ساخته شدن خروجی این مرحله‌ها ثبت شده و ممکن است در آن‌ها لحاظ نشده باشد: {stages}.',
    behindHint:
      'در تب هر مرحله «درخواست بازبینی» بفرستید (پیشنهاد متنش آماده است) یا مرحله را از نو اجرا کنید.',
    openStage: 'رفتن به «{stage}»',
    edit: 'ویرایش',
    save: 'ذخیره',
    cancel: 'انصراف',
    withdraw: 'برداشتن',
    withdrawReason: 'دلیل (اختیاری)',
    confirmWithdraw: 'برداشتن این الزام',
    editNote: 'ویرایش، الزام قبلی را با نسخه تازه جایگزین می‌کند و قبلی در تاریخچه می‌ماند.',
    history: 'تاریخچه ({n})',
    historyEmpty: 'هنوز الزامی برداشته یا جایگزین نشده است.',
    ended: { withdrawn: 'برداشته‌شده', replaced: 'جایگزین‌شده' },
    endedAt: 'در {at}',
    checkTitle: 'پوشش الزامات در خروجی',
    checkHelp:
      'ایجنت ارزیاب خروجی مرحله‌ها و سندها را با فهرست بالا می‌سنجد و برای هر الزام می‌گوید پوشش داده شده یا نه. این کار یک فراخوانی مدل است.',
    check: 'سنجش پوشش',
    checking: 'در حال سنجش…',
    recheck: 'سنجش دوباره',
    noCheck: 'هنوز سنجیده نشده است.',
    stale: 'از آخرین سنجش، الزام‌ها یا خروجی‌ها عوض شده‌اند؛ این نتیجه قدیمی است. دوباره بسنجید.',
    checkedAt: 'آخرین سنجش: {at}',
    summary:
      '{covered} پوشش‌داده‌شده، {partial} ناقص، {notCovered} پوشش‌داده‌نشده، {unknown} نامشخص از {total}',
    foundIn: 'در: {where}',
    verdicts: {
      must: {
        covered: 'پوشش داده شده',
        partial: 'ناقص',
        not_covered: 'پوشش داده نشده',
        unknown: 'سنجیده نشده',
      },
      must_not: {
        covered: 'رعایت شده',
        partial: 'تا حدی رعایت شده',
        not_covered: 'رعایت نشده',
        unknown: 'سنجیده نشده',
      },
    },
    stagesNames: {
      analysis: 'تحلیل',
      research: 'تحقیق',
      ideation: 'ایده',
      documentation: 'مستند',
      evaluation: 'ارزیابی',
    } as Record<string, string>,
    errors: {
      OUTPUT_REQUIREMENT_INVALID_REQUEST: 'نوع و متنی دست‌کم سه حرفی لازم است.',
      OUTPUT_REQUIREMENT_DUPLICATE: 'این الزام قبلا ثبت شده است.',
      OUTPUT_REQUIREMENT_LIMIT: 'به سقف الزام‌های فعال رسیده‌اید؛ یکی را بردارید.',
      OUTPUT_REQUIREMENT_ENDED: 'این الزام قبلا برداشته یا جایگزین شده است؛ صفحه را تازه کنید.',
      OUTPUT_REQUIREMENT_UNCHANGED: 'چیزی را عوض نکرده‌اید.',
      OUTPUT_REQUIREMENTS_NONE: 'ابتدا دست‌کم یک الزام بنویسید.',
      OUTPUT_REQUIREMENTS_NO_MATERIAL: 'هنوز خروجی‌ای نیست که بسنجیم.',
      OUTPUT_REQUIREMENTS_CHECK_FAILED: 'سنجش انجام نشد. دوباره تلاش کنید.',
      AI_NOT_CONFIGURED: 'هوش مصنوعی هنوز تنظیم نشده است.',
    } as Record<string, string>,
    generic: 'انجام نشد. دوباره تلاش کنید.',
    loadFailed: 'الزامات خروجی بارگذاری نشد.',
  },
  en: {
    title: 'Output requirements',
    help: 'Whenever it occurs to you what the output must or must not contain, write it here, either for the final output as a whole or for just one stage (from analysis to evaluation). At the end you can check which items the output covers. You can also add any message of a conversation with an agent to this list from there.',
    scopesLabel: 'Requirements by stage',
    scopes: {
      final: 'Final output',
      analysis: 'Analysis',
      research: 'Research',
      ideation: 'Ideas',
      documentation: 'Documents',
      evaluation: 'Evaluation',
    } as Record<string, string>,
    scopeHelp: {
      final:
        'Requirements for the final output of the project. The agents of every stage read them and each respects them within its own work.',
      analysis: 'Only the Analysis agent reads these; for example questions that must be asked.',
      research:
        'Only the Research agent reads these; for example sources that must or must not be used.',
      ideation:
        'Only the Ideas agent reads these; for example a budget limit or the kind of solutions.',
      documentation:
        'Only the document writer and the document evaluator read these; for example sections and tone.',
      evaluation:
        'Only the Evaluation agent reads these; for example criteria that must be assessed.',
    } as Record<string, string>,
    emptyScope: 'No requirement for this part yet.',
    appliesTo: 'Applies to',
    appliesToStage: 'Only for “{stage}”',
    kind: 'Kind',
    kinds: { must: 'Must have', must_not: 'Must not have' },
    text: 'Requirement',
    placeholder: 'For example: a “Risks” section with an owner for each risk',
    add: 'Add requirement',
    adding: 'Adding…',
    empty: 'No requirement yet.',
    count: '{n} of {limit} active requirements',
    sources: { admin: 'Written by you', chat: 'From a conversation with an agent' },
    addedAt: 'Added {at}',
    inStage: 'while working on “{stage}”',
    behind:
      'This was added after the output of these stages was written, so it may not be reflected in them: {stages}.',
    behindHint:
      'Send a revision request on the tab of each stage (a suggested text is ready) or redo the stage.',
    openStage: 'Go to “{stage}”',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    withdraw: 'Withdraw',
    withdrawReason: 'Reason (optional)',
    confirmWithdraw: 'Withdraw this requirement',
    editNote: 'An edit replaces the requirement with a new one; the old one stays in the history.',
    history: 'History ({n})',
    historyEmpty: 'No requirement was withdrawn or replaced yet.',
    ended: { withdrawn: 'Withdrawn', replaced: 'Replaced' },
    endedAt: 'on {at}',
    checkTitle: 'Coverage of the requirements',
    checkHelp:
      'The evaluator compares the stage outputs and the documents with the list above and says, for each requirement, whether it is covered. This costs one model call.',
    check: 'Check coverage',
    checking: 'Checking…',
    recheck: 'Check again',
    noCheck: 'Not checked yet.',
    stale:
      'Requirements or outputs changed since the last check, so this result is out of date. Check again.',
    checkedAt: 'Last check: {at}',
    summary:
      '{covered} covered, {partial} partial, {notCovered} not covered, {unknown} unknown of {total}',
    foundIn: 'In: {where}',
    verdicts: {
      must: {
        covered: 'Covered',
        partial: 'Partial',
        not_covered: 'Not covered',
        unknown: 'Not checked',
      },
      must_not: {
        covered: 'Respected',
        partial: 'Partly respected',
        not_covered: 'Not respected',
        unknown: 'Not checked',
      },
    },
    stagesNames: {
      analysis: 'Analysis',
      research: 'Research',
      ideation: 'Ideas',
      documentation: 'Documents',
      evaluation: 'Evaluation',
    } as Record<string, string>,
    errors: {
      OUTPUT_REQUIREMENT_INVALID_REQUEST:
        'A kind and a text of at least three characters are needed.',
      OUTPUT_REQUIREMENT_DUPLICATE: 'This requirement already exists.',
      OUTPUT_REQUIREMENT_LIMIT: 'You reached the limit of active requirements; withdraw one.',
      OUTPUT_REQUIREMENT_ENDED:
        'This requirement was already withdrawn or replaced; reload the page.',
      OUTPUT_REQUIREMENT_UNCHANGED: 'You did not change anything.',
      OUTPUT_REQUIREMENTS_NONE: 'Write at least one requirement first.',
      OUTPUT_REQUIREMENTS_NO_MATERIAL: 'There is no output to check yet.',
      OUTPUT_REQUIREMENTS_CHECK_FAILED: 'The check did not work. Try again.',
      AI_NOT_CONFIGURED: 'AI is not configured yet.',
    } as Record<string, string>,
    generic: 'It did not work. Try again.',
    loadFailed: 'The output requirements could not be loaded.',
  },
} as const;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

const TONE: Record<Verdict, string> = {
  covered: 'tone-ok',
  partial: 'tone-warn',
  not_covered: 'tone-danger',
  unknown: 'tone-neutral',
};

/** Loads the requirements of a project and the calls that change them. */
export function useRequirements(base: string, locale: Locale, refreshKey = 0) {
  const text = copy[locale];
  const [data, setData] = useState<RequirementsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet<RequirementsData>(`${base}/output-requirements`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const run = useCallback(
    async (name: string, work: () => Promise<void>): Promise<boolean> => {
      if (busy) return false;
      setBusy(name);
      setError('');
      try {
        await work();
        return true;
      } catch (caught) {
        setError(
          (caught instanceof ApiError && caught.code && text.errors[caught.code]) || text.generic,
        );
        return false;
      } finally {
        setBusy(null);
        await load();
      }
    },
    [busy, load, text],
  );

  return { data, failed, busy, error, load, run };
}

/** The checklist of the last coverage check, with the button that makes a new one. */
export function CoverageView({
  locale,
  base,
  data,
  busy,
  run,
  heading = 'h3',
}: {
  locale: Locale;
  base: string;
  data: RequirementsData;
  busy: string | null;
  run: (name: string, work: () => Promise<void>) => Promise<boolean>;
  heading?: 'h2' | 'h3';
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const check = data.check;
  const Heading = heading;
  return (
    <section className="stack" aria-labelledby={`${id}-check`}>
      <Heading id={`${id}-check`}>{text.checkTitle}</Heading>
      <p className="muted">{text.checkHelp}</p>
      {check ? (
        <>
          <p className="muted">{fill(text.checkedAt, { at: formatDateTime(locale, check.at) })}</p>
          <p role="status">
            {fill(text.summary, {
              covered: formatNumber(locale, check.summary.covered),
              partial: formatNumber(locale, check.summary.partial),
              notCovered: formatNumber(locale, check.summary.notCovered),
              unknown: formatNumber(locale, check.summary.unknown),
              total: formatNumber(locale, check.summary.total),
            })}
          </p>
          {check.stale && (
            <p className="notice warn" role="status">
              {text.stale}
            </p>
          )}
          <ul className="plain-list">
            {check.results.map((line) => (
              <li key={line.requirementId}>
                <span className={`badge ${TONE[line.verdict]}`}>
                  {text.verdicts[line.kind][line.verdict]}
                </span>{' '}
                <span className="badge">{text.kinds[line.kind]}</span>
                {line.target && (
                  <>
                    {' '}
                    <span className="badge">
                      {fill(text.appliesToStage, {
                        stage: text.scopes[line.target] ?? line.target,
                      })}
                    </span>
                  </>
                )}
                <p dir={textDir(locale)}>{line.text}</p>
                {line.evidence && (
                  <p className="muted" dir={textDir(locale)}>
                    {line.evidence}
                    {line.foundIn && ` — ${fill(text.foundIn, { where: line.foundIn })}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{text.noCheck}</p>
      )}
      {!readOnly && (
        <div className="toolbar">
          <button
            data-write-action
            className="secondary-button"
            type="button"
            disabled={busy !== null || data.items.length === 0}
            onClick={() =>
              void run('check', async () => {
                await apiSend('POST', `${base}/output-requirements/check`);
              })
            }
          >
            {busy === 'check' ? text.checking : check ? text.recheck : text.check}
          </button>
        </div>
      )}
    </section>
  );
}

/** The coverage checklist alone, for the evaluation tab. */
export function RequirementCoverage({
  locale,
  base,
  refreshKey = 0,
}: {
  locale: Locale;
  base: string;
  refreshKey?: number;
}) {
  const text = copy[locale];
  const { data, failed, busy, error, run } = useRequirements(base, locale, refreshKey);
  if (failed && !data) {
    return (
      <section className="card">
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      </section>
    );
  }
  if (!data) return null;
  if (data.items.length === 0 && !data.check) return null;
  return (
    <div className="card stack">
      <CoverageView locale={locale} base={base} data={data} busy={busy} run={run} heading="h2" />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * ADR-0037: the requirements of the final output. They can be written at any moment; the agents
 * of every stage read the active ones, and a check says which ones the output covers.
 */
export function RequirementsPanel({
  locale,
  base,
  refreshKey = 0,
  onOpenStage,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  refreshKey?: number;
  onOpenStage: (stage: string) => void;
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const { data, failed, busy, error, run } = useRequirements(base, locale, refreshKey);
  const [scope, setScope] = useState<RequirementScope>('final');
  const [kind, setKind] = useState<RequirementKind>('must');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{
    id: string;
    kind: RequirementKind;
    text: string;
    scope: RequirementScope;
  } | null>(null);
  const [withdrawing, setWithdrawing] = useState<{ id: string; reason: string } | null>(null);

  if (failed && !data) {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{text.title}</h2>
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      </section>
    );
  }
  if (!data) return null;

  const stageName = (stage: string) => text.stagesNames[stage] ?? stage;
  const full = data.items.length >= data.limit;
  const shown = data.items.filter((item) => scopeOf(item) === scope);
  const countOf = (name: RequirementScope) =>
    data.items.filter((item) => scopeOf(item) === name).length;

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{text.title}</h2>
        <p className="muted">{text.help}</p>

        <nav className="section-nav" aria-label={text.scopesLabel}>
          <ul>
            {REQUIREMENT_SCOPES.map((name) => (
              <Fragment key={name}>
                <li>
                  <button
                    type="button"
                    aria-current={scope === name ? 'page' : undefined}
                    onClick={() => {
                      setScope(name);
                      setEditing(null);
                      setWithdrawing(null);
                    }}
                  >
                    {text.scopes[name]}{' '}
                    <span className="badge">{formatNumber(locale, countOf(name))}</span>
                  </button>
                </li>
                {name === 'final' && <li className="section-nav-divider" aria-hidden="true" />}
              </Fragment>
            ))}
          </ul>
        </nav>
        <p className="muted">{text.scopeHelp[scope]}</p>

        {!readOnly && (
          <form
            className="field-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run('add', async () => {
                await apiSend('POST', `${base}/output-requirements`, {
                  kind,
                  text: draft,
                  ...(scope === 'final' ? {} : { target: scope }),
                });
                setDraft('');
              });
            }}
          >
            <label htmlFor={`${id}-kind`}>{text.kind}</label>
            <select
              id={`${id}-kind`}
              value={kind}
              onChange={(event) => setKind(event.target.value as RequirementKind)}
            >
              <option value="must">{text.kinds.must}</option>
              <option value="must_not">{text.kinds.must_not}</option>
            </select>
            <label htmlFor={`${id}-text`}>{text.text}</label>
            <textarea
              id={`${id}-text`}
              rows={3}
              dir={textDir(locale)}
              maxLength={data.textMax}
              value={draft}
              placeholder={text.placeholder}
              disabled={busy !== null || full}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="toolbar">
              <button
                data-write-action
                className="primary-button"
                type="submit"
                disabled={busy !== null || full || draft.trim().length < 3}
              >
                {busy === 'add' ? text.adding : text.add}
              </button>
              <small className="muted">
                {fill(text.count, {
                  n: formatNumber(locale, data.items.length),
                  limit: formatNumber(locale, data.limit),
                })}
              </small>
            </div>
          </form>
        )}

        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}

        {data.items.length === 0 ? (
          <p className="muted">{text.empty}</p>
        ) : shown.length === 0 ? (
          <p className="muted">{text.emptyScope}</p>
        ) : (
          <ol className="plain-list">
            {shown.map((item) => (
              <li key={item.id}>
                {editing?.id === item.id ? (
                  <form
                    className="field-stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run('edit', async () => {
                        await apiSend('PATCH', `${base}/output-requirements/${item.id}`, {
                          kind: editing.kind,
                          text: editing.text,
                          target: editing.scope === 'final' ? null : editing.scope,
                        });
                        setEditing(null);
                      });
                    }}
                  >
                    <label htmlFor={`${id}-edit-kind`}>{text.kind}</label>
                    <select
                      id={`${id}-edit-kind`}
                      value={editing.kind}
                      onChange={(event) =>
                        setEditing({ ...editing, kind: event.target.value as RequirementKind })
                      }
                    >
                      <option value="must">{text.kinds.must}</option>
                      <option value="must_not">{text.kinds.must_not}</option>
                    </select>
                    <label htmlFor={`${id}-edit-scope`}>{text.appliesTo}</label>
                    <select
                      id={`${id}-edit-scope`}
                      value={editing.scope}
                      onChange={(event) =>
                        setEditing({ ...editing, scope: event.target.value as RequirementScope })
                      }
                    >
                      {REQUIREMENT_SCOPES.map((name) => (
                        <option key={name} value={name}>
                          {text.scopes[name]}
                        </option>
                      ))}
                    </select>
                    <label htmlFor={`${id}-edit-text`}>{text.text}</label>
                    <textarea
                      id={`${id}-edit-text`}
                      rows={3}
                      dir={textDir(locale)}
                      maxLength={data.textMax}
                      value={editing.text}
                      onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                    />
                    <small className="muted">{text.editNote}</small>
                    <div className="toolbar">
                      <button
                        data-write-action
                        className="primary-button"
                        type="submit"
                        disabled={busy !== null || editing.text.trim().length < 3}
                      >
                        {text.save}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setEditing(null)}
                      >
                        {text.cancel}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <span className={`badge ${item.kind === 'must' ? 'tone-ok' : 'tone-danger'}`}>
                      {text.kinds[item.kind]}
                    </span>
                    <p dir={textDir(locale)}>{item.text}</p>
                    <p className="muted">
                      {text.sources[item.source]} ·{' '}
                      {fill(text.addedAt, { at: formatDateTime(locale, item.createdAt) })}
                      {item.stage && ` · ${fill(text.inStage, { stage: stageName(item.stage) })}`}
                    </p>
                    {item.behindStages.length > 0 && (
                      <div className="notice warn" role="status">
                        <p>
                          {fill(text.behind, {
                            stages: item.behindStages.map(stageName).join('، '),
                          })}
                        </p>
                        <p>{text.behindHint}</p>
                        <div className="toolbar compact">
                          {item.behindStages.map((stage) => (
                            <button
                              key={stage}
                              className="secondary-button"
                              type="button"
                              onClick={() => onOpenStage(stage)}
                            >
                              {fill(text.openStage, { stage: stageName(stage) })}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!readOnly &&
                      (withdrawing?.id === item.id ? (
                        <div className="field-stack">
                          <label htmlFor={`${id}-reason`}>{text.withdrawReason}</label>
                          <input
                            id={`${id}-reason`}
                            dir={textDir(locale)}
                            maxLength={500}
                            value={withdrawing.reason}
                            onChange={(event) =>
                              setWithdrawing({ id: item.id, reason: event.target.value })
                            }
                          />
                          <div className="toolbar">
                            <button
                              data-write-action
                              className="secondary-button"
                              type="button"
                              disabled={busy !== null}
                              onClick={() =>
                                void run('withdraw', async () => {
                                  await apiSend(
                                    'POST',
                                    `${base}/output-requirements/${item.id}/withdraw`,
                                    { reason: withdrawing.reason },
                                  );
                                  setWithdrawing(null);
                                })
                              }
                            >
                              {text.confirmWithdraw}
                            </button>
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={busy !== null}
                              onClick={() => setWithdrawing(null)}
                            >
                              {text.cancel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="toolbar compact">
                          <button
                            data-write-action
                            className="secondary-button"
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                              setEditing({
                                id: item.id,
                                kind: item.kind,
                                text: item.text,
                                scope: scopeOf(item),
                              })
                            }
                          >
                            {text.edit}
                          </button>
                          <button
                            data-write-action
                            className="secondary-button"
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setWithdrawing({ id: item.id, reason: '' })}
                          >
                            {text.withdraw}
                          </button>
                        </div>
                      ))}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card">
        <CoverageView locale={locale} base={base} data={data} busy={busy} run={run} />
      </section>

      <section className="card stack">
        <details>
          <summary>{fill(text.history, { n: formatNumber(locale, data.history.length) })}</summary>
          {data.history.length === 0 ? (
            <p className="muted">{text.historyEmpty}</p>
          ) : (
            <ul className="plain-list">
              {data.history.map((item) => (
                <li key={item.id}>
                  <span className="badge tone-neutral">{text.ended[item.endedKind]}</span>{' '}
                  <span className="badge">{text.kinds[item.kind]}</span>
                  <p dir={textDir(locale)}>{item.text}</p>
                  <p className="muted">
                    {text.sources[item.source]} ·{' '}
                    {fill(text.addedAt, { at: formatDateTime(locale, item.createdAt) })} ·{' '}
                    {text.ended[item.endedKind]}{' '}
                    {fill(text.endedAt, { at: formatDateTime(locale, item.endedAt) })}
                    {item.endedReason && ` — ${item.endedReason}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </div>
  );
}
