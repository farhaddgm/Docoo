'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { emptyMeetingState, type MeetingState, type MeetingResponse } from '@docoo/contracts';
import { useReadOnlyAccess } from '../../../resource-access';
import './meeting.css';
interface Run {
  id: string;
  revision: number;
  mode: 'prepare' | 'rehearse';
  content: string;
  status: string;
  result: MeetingResponse | null;
}
interface Detail {
  revision: number;
  state: MeetingState;
  patternVersion: number;
  runs: Run[];
  nextCursor: string | null;
}
export function MeetingScreen({
  locale,
  projectId,
  workspaceId,
}: {
  locale: 'fa' | 'en';
  projectId: string;
  workspaceId: string;
}) {
  const fa = locale === 'fa';
  const t = (persian: string, english: string) => (fa ? persian : english);
  const readOnly = useReadOnlyAccess();
  const base = `/api/workspaces/${workspaceId}/projects/${projectId}/meeting`;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<MeetingState>(emptyMeetingState);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'prepare' | 'rehearse'>('prepare');
  const [difficulty, setDifficulty] = useState('hesitant');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null);
  const dirty = !!detail && JSON.stringify(draft) !== JSON.stringify(detail.state);
  const api = useCallback(
    async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
      const response = await fetch(`${base}${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { code?: string };
        throw new Error(
          response.status === 404
            ? fa
              ? 'این پروژه الگوی جلسه ندارد یا دسترسی ممکن نیست.'
              : 'This project has no meeting pattern or is unavailable.'
            : response.status === 403
              ? fa
                ? 'اجازه ویرایش این پروژه را ندارید.'
                : 'You cannot edit this project.'
              : response.status === 409
                ? fa
                  ? 'وضعیت تغییر کرده یا درخواست دیگری در حال اجراست. تازه‌سازی کنید.'
                  : 'The state changed or another request is active. Refresh.'
                : failure.code === 'PATTERN_AI_NOT_CONFIGURED'
                  ? fa
                    ? 'سرویس AI فعال نیست؛ ویرایش دستی و برگه آمادگی در دسترس‌اند.'
                    : 'AI is not configured. Manual editing and the brief remain available.'
                  : fa
                    ? 'درخواست کامل نشد؛ اطلاعات ذخیره‌شده محفوظ است.'
                    : 'The request did not complete. Saved information is preserved.',
        );
      }
      return (await response.json()) as T;
    },
    [base, fa],
  );
  const load = useCallback(async () => {
    const value = await api<Detail>('');
    setDetail(value);
    setDraft(value.state);
  }, [api]);
  useEffect(() => {
    let active = true;
    api<Detail>('')
      .then((value) => {
        if (active) {
          setDetail(value);
          setDraft(value.state);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Error');
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [api]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('درخواست ناموفق بود.', 'Request failed.'),
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  async function save(state = draft) {
    if (!detail) return 0;
    const result = await api<{ revision: number; state: MeetingState }>('', 'PUT', {
      expectedRevision: detail.revision,
      state,
    });
    setDetail({ ...detail, ...result });
    setDraft(result.state);
    setNotice(t('آمادگی ذخیره شد.', 'Preparation saved.'));
    return result.revision;
  }
  async function send() {
    if (!detail || !message.trim() || !consent) return;
    const revision = dirty || detail.revision === 0 ? await save() : detail.revision;
    const controller = new AbortController();
    abort.current = controller;
    const result = await api<Run>(
      '/messages',
      'POST',
      {
        expectedRevision: revision,
        mode,
        content: message,
        difficulty,
        providerConsent: true,
        idempotencyKey: crypto.randomUUID(),
      },
      controller.signal,
    );
    await load();
    setConsent(false);
    if (result.status === 'complete') setMessage('');
    else
      setNotice(
        t(
          'پاسخ هنوز کامل نشده است؛ تاریخچه را تازه‌سازی کنید.',
          'The response is not complete; refresh the history.',
        ),
      );
  }
  const contextLabels: Record<keyof MeetingState['context'], string> = {
    counterpart: t('با چه کسی ملاقات داری؟', 'Who are you meeting?'),
    relationship: t('رابطه شما', 'Your relationship'),
    topic: t('موضوع ملاقات', 'Meeting topic'),
    goal: t('نتیجه مطلوب', 'Desired outcome'),
    concerns: t('نگرانی یا واکنش سخت', 'Concern or difficult reaction'),
    boundaries: t('مرزهای من', 'My boundaries'),
    flexibility: t('موارد قابل انعطاف', 'Where I can be flexible'),
  };
  const briefLabels: Record<Exclude<keyof MeetingState['brief'], 'points'>, string> = {
    goal: t('هدف اصلی من', 'My main goal'),
    opening: t('جمله شروع', 'Opening line'),
    hardPart: t('بخش سخت', 'The difficult part'),
    response: t('نحوه مواجهه', 'How I will respond'),
    boundary: t('چیزی که نباید فراموش کنم', 'What I must remember'),
  };
  const briefText = () =>
    `${draft.brief.goal}\n\n${draft.brief.opening}\n\n${draft.brief.points
      .filter(Boolean)
      .map((point, index) => `${index + 1}. ${point}`)
      .join('\n')}\n\n${draft.brief.hardPart}\n${draft.brief.response}\n\n${draft.brief.boundary}`;
  return (
    <main className="meeting-page" dir={fa ? 'rtl' : 'ltr'}>
      <Link href={`/${locale}/projects` as Route}>
        {t('بازگشت به پروژه‌ها', 'Back to projects')}
      </Link>
      <h1>{t('آمادگی برای جلسه', 'Meeting preparation')}</h1>
      <p>
        {t(
          'از یک توضیح کوتاه شروع کنید؛ هدف، بخش سخت و برگه همراه را روشن کنید. تمرین و مرور بعد از ملاقات اختیاری‌اند.',
          'Start with a short explanation; clarify your goal, practice the difficult part and take a brief with you. Practice and reflection are optional.',
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!detail && !error && <p role="status">{t('در حال بارگذاری…', 'Loading…')}</p>}
      {detail && (
        <>
          <div className="meeting-actions">
            <button disabled={busy || dirty} onClick={() => void action(load)}>
              {t('تازه‌سازی', 'Refresh')}
            </button>
            <button
              disabled={busy || readOnly || (!dirty && detail.revision > 0)}
              onClick={() =>
                void action(async () => {
                  await save();
                })
              }
            >
              {t('ذخیره آمادگی', 'Save preparation')}
            </button>
            <button disabled={busy || !dirty} onClick={() => setDraft(detail.state)}>
              {t('کنار گذاشتن تغییرات', 'Discard changes')}
            </button>
          </div>
          {dirty && (
            <p role="status">
              {t(
                'تغییرات ذخیره نشده‌اند. ارسال پیام، اطلاعات فعلی را پیش از درخواست ذخیره می‌کند.',
                'Unsaved changes. Sending a message saves the current information first.',
              )}
            </p>
          )}
          <div className="meeting-columns">
            <section>
              <h2>{t('گفتگو و تمرین', 'Conversation and practice')}</h2>
              <div className="meeting-history">
                {detail.runs.map((run) => (
                  <article className="meeting-card" key={run.id}>
                    <h3>
                      {run.mode === 'rehearse'
                        ? t('تمرین', 'Practice')
                        : t('آماده‌سازی', 'Preparation')}{' '}
                      · {t('ویرایش', 'Revision')} {run.revision}
                    </h3>
                    <p className="meeting-text">{run.content}</p>
                    {run.status === 'pending' && (
                      <p>
                        {t(
                          'در انتظار پاسخ؛ اگر ارتباط قطع شده کمی بعد درخواست تازه‌ای بفرستید.',
                          'Waiting for a response; after a disconnection, wait briefly before a new request.',
                        )}
                      </p>
                    )}
                    {run.status === 'failed' && (
                      <p>
                        {t(
                          'پاسخ معتبر ذخیره نشد؛ می‌توانید دوباره تلاش کنید.',
                          'No valid response was saved. You can try again.',
                        )}
                      </p>
                    )}
                    {run.result && (
                      <>
                        <p className="meeting-text">{run.result.answer}</p>
                        {run.result.feedback && (
                          <div>
                            <h4>{t('بازخورد مشخص', 'Concrete feedback')}</h4>
                            <p>{run.result.feedback.strength}</p>
                            <p>{run.result.feedback.improvement}</p>
                            <p>{run.result.feedback.retrySuggestion}</p>
                            <button
                              disabled={busy || readOnly || draft.practice !== 'practicing'}
                              onClick={() => {
                                setMode('rehearse');
                                setMessage('');
                                setNotice(
                                  t(
                                    'همان بخش را با بیان تازه تمرین کنید.',
                                    'Try the same part again in your own words.',
                                  ),
                                );
                              }}
                            >
                              {t('تلاش دوباره', 'Try again')}
                            </button>
                          </div>
                        )}
                        {run.result.brief && (
                          <div>
                            <h4>{t('پیشنهاد برگه آمادگی', 'Suggested preparation brief')}</h4>
                            <p>{run.result.brief.goal}</p>
                            <p>{run.result.brief.opening}</p>
                            <ul>
                              {run.result.brief.points.map((point, index) => (
                                <li key={index}>{point}</li>
                              ))}
                            </ul>
                            <p>
                              {run.result.brief.hardPart} {run.result.brief.response}
                            </p>
                            <p>{run.result.brief.boundary}</p>
                            <button
                              disabled={
                                busy || readOnly || dirty || run.revision !== detail.revision
                              }
                              onClick={() => {
                                const result = run.result!;
                                setDraft({
                                  ...draft,
                                  context: result.context ?? draft.context,
                                  brief: result.brief!,
                                  perspectives: result.perspectives,
                                });
                                setNotice(
                                  t(
                                    'پیشنهاد برای بازبینی وارد برگه شد؛ پس از اصلاح ذخیره کنید.',
                                    'Suggestion loaded for review. Edit and save to accept.',
                                  ),
                                );
                              }}
                            >
                              {t('بازبینی پیشنهاد در برگه', 'Review suggestion in brief')}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
              {detail.nextCursor && (
                <button
                  disabled={busy || dirty}
                  onClick={() =>
                    void action(async () => {
                      const older = await api<Detail>(`?before=${detail.nextCursor}`);
                      setDetail({
                        ...detail,
                        runs: [
                          ...older.runs.filter(
                            (run) => !detail.runs.some((existing) => existing.id === run.id),
                          ),
                          ...detail.runs,
                        ],
                        nextCursor: older.nextCursor,
                      });
                    })
                  }
                >
                  {t('نمایش گفتگوهای قدیمی‌تر', 'Older conversations')}
                </button>
              )}
              <fieldset disabled={busy || readOnly}>
                <legend>{t('پیام تازه', 'New message')}</legend>
                <label>
                  {t('نوع گفتگو', 'Conversation mode')}
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as typeof mode)}
                  >
                    <option value="prepare">
                      {t('روشن کردن موقعیت و ساخت برگه', 'Clarify and prepare the brief')}
                    </option>
                    <option value="rehearse" disabled={draft.practice !== 'practicing'}>
                      {t('نقش‌آفرینی طرف مقابل', 'Counterpart role-play')}
                    </option>
                  </select>
                </label>
                {mode === 'rehearse' && (
                  <label>
                    {t('شدت واکنش طرف مقابل', 'Counterpart difficulty')}
                    <select
                      value={difficulty}
                      onChange={(event) => setDifficulty(event.target.value)}
                    >
                      <option value="supportive">{t('همراه', 'Supportive')}</option>
                      <option value="hesitant">{t('مردد', 'Hesitant')}</option>
                      <option value="challenging">{t('چالش‌برانگیز', 'Challenging')}</option>
                    </select>
                  </label>
                )}
                <label>
                  {mode === 'rehearse'
                    ? t('جمله‌ای که در جلسه می‌گویید', 'What you would say in the meeting')
                    : t('توضیح موقعیت یا پاسخ شما', 'Describe the situation or answer a question')}
                  <textarea
                    rows={5}
                    maxLength={4000}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  {t(
                    'اجازه می‌دهم پیام، اطلاعات آمادگی و بخش محدودی از همین گفتگو برای پاسخ‌گویی به سرویس AI ارسال شود.',
                    'I consent to sending my message, preparation state and limited conversation history to the AI provider.',
                  )}
                </label>
                <button disabled={!consent || !message.trim()} onClick={() => void action(send)}>
                  {t('ارسال پیام', 'Send message')}
                </button>
              </fieldset>
              {busy && (
                <p role="status">
                  {t('در حال انجام درخواست…', 'Processing…')}
                  <button disabled={!abort.current} onClick={() => abort.current?.abort()}>
                    {t('لغو درخواست', 'Cancel request')}
                  </button>
                </p>
              )}
              <h3>{t('تمرین اختیاری', 'Optional practice')}</h3>
              <p>
                {draft.practice === 'skipped'
                  ? t(
                      'از تمرین صرف‌نظر کرده‌اید؛ می‌توانید برگه را تکمیل کنید.',
                      'Practice skipped. You can continue with the brief.',
                    )
                  : t(
                      'یک شروع، درخواست دشوار یا پاسخ حساس را با حرف‌های خودتان تمرین کنید.',
                      'Practice an opening, difficult request or sensitive answer in your own words.',
                    )}
              </p>
              <button
                disabled={busy || readOnly}
                onClick={() =>
                  void action(async () => {
                    await save({ ...draft, practice: 'practicing' });
                    setMode('rehearse');
                  })
                }
              >
                {t('شروع تمرین', 'Start practice')}
              </button>
              <button
                disabled={busy || readOnly}
                onClick={() =>
                  void action(async () => {
                    await save({ ...draft, practice: 'skipped' });
                    setMode('prepare');
                  })
                }
              >
                {t('ادامه بدون تمرین', 'Continue without practice')}
              </button>
            </section>
            <section>
              <fieldset disabled={busy || readOnly}>
                <legend>{t('شناخت موقعیت و خواسته من', 'My situation and goal')}</legend>
                {(Object.keys(contextLabels) as (keyof MeetingState['context'])[]).map((key) => (
                  <label key={key}>
                    {contextLabels[key]}
                    <textarea
                      maxLength={4000}
                      rows={2}
                      value={draft.context[key]}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          context: { ...draft.context, [key]: event.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
              <section>
                <h2>{t('دیدگاه احتمالی طرف مقابل', 'Possible counterpart perspectives')}</h2>
                <p>
                  {t(
                    'این موارد فرضیه‌اند و باید با واقعیت بررسی شوند.',
                    'These are hypotheses to check against reality.',
                  )}
                </p>
                <ul>
                  {draft.perspectives.map((perspective, index) => (
                    <li key={index}>
                      {t('احتمال: ', 'Possibility: ')}
                      {perspective.text}
                      {!readOnly && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              perspectives: draft.perspectives.filter((_, i) => i !== index),
                            })
                          }
                        >
                          {t('حذف', 'Remove')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <fieldset disabled={busy || readOnly} className="meeting-brief">
                <legend>{t('برگه آمادگی همراه', 'My preparation brief')}</legend>
                {(Object.keys(briefLabels) as (keyof typeof briefLabels)[]).map((key) => (
                  <label key={key}>
                    {briefLabels[key]}
                    <textarea
                      maxLength={4000}
                      rows={2}
                      value={draft.brief[key]}
                      onChange={(event) =>
                        setDraft({ ...draft, brief: { ...draft.brief, [key]: event.target.value } })
                      }
                    />
                  </label>
                ))}
                {[0, 1, 2].map((index) => (
                  <label key={index}>
                    {t('نکته یا سؤال مهم', 'Important point or question')} {index + 1}
                    <input
                      maxLength={4000}
                      value={draft.brief.points[index] ?? ''}
                      onChange={(event) => {
                        const points = [...draft.brief.points];
                        while (points.length < 3) points.push('');
                        points[index] = event.target.value;
                        setDraft({ ...draft, brief: { ...draft.brief, points } });
                      }}
                    />
                  </label>
                ))}
              </fieldset>
              <div className="meeting-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await navigator.clipboard.writeText(briefText());
                      setNotice(t('برگه کپی شد.', 'Brief copied.'));
                    })
                  }
                >
                  {t('کپی برگه', 'Copy brief')}
                </button>
                <button onClick={() => window.print()}>{t('چاپ برگه', 'Print brief')}</button>
                <button
                  disabled={busy || readOnly}
                  onClick={() =>
                    void action(async () => {
                      await save();
                    })
                  }
                >
                  {t('ذخیره برگه', 'Save brief')}
                </button>
              </div>
              <fieldset disabled={busy || readOnly}>
                <legend>
                  {t('مرور اختیاری پس از ملاقات', 'Optional post-meeting reflection')}
                </legend>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.reflection.occurred}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        reflection: event.target.checked
                          ? { ...draft.reflection, occurred: true }
                          : { occurred: false, outcome: '', surprises: '', nextTime: '' },
                      })
                    }
                  />
                  {t('ملاقات برگزار شده است', 'The meeting has happened')}
                </label>
                {draft.reflection.occurred &&
                  (['outcome', 'surprises', 'nextTime'] as const).map((key) => (
                    <label key={key}>
                      {
                        {
                          outcome: t('چه شد؟', 'What happened?'),
                          surprises: t('چه چیزی غافلگیرتان کرد؟', 'What surprised you?'),
                          nextTime: t(
                            'دفعه بعد چه تغییری می‌دهید؟',
                            'What will you change next time?',
                          ),
                        }[key]
                      }
                      <textarea
                        rows={3}
                        maxLength={4000}
                        value={draft.reflection[key]}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            reflection: { ...draft.reflection, [key]: event.target.value },
                          })
                        }
                      />
                    </label>
                  ))}
                <button
                  onClick={() =>
                    void action(async () => {
                      await save();
                    })
                  }
                >
                  {t('ذخیره مرور نتیجه', 'Save reflection')}
                </button>
              </fieldset>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
