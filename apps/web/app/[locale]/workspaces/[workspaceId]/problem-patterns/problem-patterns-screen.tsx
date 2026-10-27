'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  marketingExperimentProblemPattern,
  meetingProblemPattern,
  problemPatternDefinitionSchema,
  type ProblemPatternDefinition,
  type PatternAiResponse,
} from '@docoo/contracts';
import { PatternEditor } from './pattern-editor';
import './patterns.css';

type Definition = ProblemPatternDefinition;
interface Summary {
  id: string;
  title: string;
  status: string;
  revision: number;
  latest_version: number | null;
}
interface Pattern {
  id: string;
  definition: Definition;
  revision: number;
  status: string;
}
interface Run {
  id: string;
  kind: 'chat' | 'test';
  revision: number;
  content: string;
  status: string;
  result: (PatternAiResponse & { metadata?: { provider: string; modelId: string } }) | null;
  error_code: string | null;
}
interface Detail {
  nextRunCursor?: string | null;
  pattern: Pattern;
  runs: Run[];
  versions: { id: string; version: number; revision: number }[];
}

export function ProblemPatternsScreen({
  locale,
  workspaceId,
}: {
  locale: 'fa' | 'en';
  workspaceId: string;
}) {
  const fa = locale === 'fa';
  const t = (persian: string, english: string) => (fa ? persian : english);
  const base = `/api/workspaces/${workspaceId}/problem-patterns`;
  const [patterns, setPatterns] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Definition | null>(null);
  const [seed, setSeed] = useState('blank');
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [sample, setSample] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [published, setPublished] = useState<{ version: number; definition: Definition } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  const dirty = !!(
    detail &&
    draft &&
    JSON.stringify(detail.pattern.definition) !== JSON.stringify(draft)
  );
  const archived = detail?.pattern.status === 'archived';
  const currentTest = detail?.runs.findLast(
    (run) =>
      run.kind === 'test' && run.status === 'complete' && run.revision === detail.pattern.revision,
  );
  const alreadyPublished = detail?.versions.some(
    (version) => version.revision === detail.pattern.revision,
  );

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
        const result = (await response.json().catch(() => ({}))) as { code?: string };
        const code = result.code;
        const message =
          response.status === 401
            ? fa
              ? 'برای ادامه وارد حساب شوید.'
              : 'Sign in to continue.'
            : response.status === 403
              ? fa
                ? 'ساخت و انتشار الگو به دسترسی ادمین نیاز دارد.'
                : 'Administrator access is required.'
              : code === 'PATTERN_AI_NOT_CONFIGURED'
                ? fa
                  ? 'سرویس AI الگوها هنوز تنظیم نشده است. ویرایش دستی در دسترس است.'
                  : 'Pattern AI is not configured. Manual editing remains available.'
                : code === 'PATTERN_AI_BUSY'
                  ? fa
                    ? 'یک درخواست در حال اجراست؛ کمی بعد تازه‌سازی کنید.'
                    : 'A request is running. Refresh shortly.'
                  : code === 'PATTERN_KEY_EXISTS'
                    ? fa
                      ? 'این شناسه قبلاً استفاده شده است.'
                      : 'This key is already in use.'
                    : response.status === 409
                      ? fa
                        ? 'وضعیت تغییر کرده یا درخواست با نسخهٔ فعلی سازگار نیست. تازه‌سازی کنید؛ ممکن است نیاز به آزمایش دوباره باشد.'
                        : 'The state changed or the request conflicts with this revision. Refresh; another preview may be needed.'
                      : response.status === 422
                        ? fa
                          ? 'اطلاعات الگو معتبر نیست. فیلدها و کلیدهای مرتبط را بررسی کنید.'
                          : 'Invalid pattern. Check fields and referenced keys.'
                        : fa
                          ? 'درخواست کامل نشد. پیش‌نویس ذخیره‌شده محفوظ است؛ تاریخچه را تازه‌سازی کنید.'
                          : 'The request did not complete. The saved draft is preserved; refresh the history.';
        throw new Error(message);
      }
      return (await response.json()) as T;
    },
    [base, fa],
  );
  const list = useCallback(async () => {
    const result = await api<{ patterns: Summary[] }>('');
    setPatterns(result.patterns);
  }, [api]);
  const open = useCallback(
    async (id: string) => {
      const result = await api<Detail>(`/${id}`);
      setDetail(result);
      setPublished(null);
      setDraft(result.pattern.definition);
    },
    [api],
  );
  useEffect(() => {
    let active = true;
    api<{ patterns: Summary[] }>('')
      .then((result) => {
        if (active) setPatterns(result.patterns);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.current?.abort();
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
    }
  }
  function validation(value: Definition) {
    const parsed = problemPatternDefinitionSchema.safeParse({
      ...value,
      research: {
        ...value.research,
        triggers: value.research.triggers.filter((item) => item.trim()),
      },
    });
    if (!parsed.success)
      throw new Error(
        t(
          'الگو معتبر نیست؛ عنوان، سؤال‌ها، کلیدهای یکتا، ارجاع ورودی‌ها و سیاست تحقیق را بررسی کنید.',
          'Check titles, questions, unique keys, input references and research policy.',
        ) + ` (${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')})`,
      );
    return parsed.data;
  }
  function readable(field: keyof Definition, value: Definition): string {
    if (field === 'inputs')
      return value.inputs
        .map(
          (item) =>
            `${item.question} · ${item.required ? t('ضروری', 'Required') : t('اختیاری', 'Optional')}`,
        )
        .join('\n');
    if (field === 'stages')
      return value.stages
        .map((stage, index) => `${index + 1}. ${stage.title}\n${stage.guidance.join('\n')}`)
        .join('\n\n');
    if (field === 'outputs')
      return value.outputs
        .map((output) => `${output.title}\n${output.sections.join('\n')}`)
        .join('\n\n');
    if (field === 'research')
      return `${value.research.mode === 'never' ? t('بدون تحقیق', 'No research') : t('تحقیق در صورت نیاز', 'Research when needed')}\n${value.research.triggers.join('\n')}`;
    const content = value[field];
    return Array.isArray(content) ? content.join('\n') : String(content);
  }

  async function create() {
    const chosen =
      seed === 'meeting'
        ? meetingProblemPattern
        : seed === 'marketing'
          ? marketingExperimentProblemPattern
          : {
              schemaVersion: 1 as const,
              key,
              title,
              purpose: t(
                'روشن کردن مسئله و ساختن خروجی قابل استفاده',
                'Clarify the problem and produce a usable output',
              ),
              applicability: [
                t('مسئله‌های مرتبط با هدف این الگو', 'Problems related to this pattern’s purpose'),
              ],
              inputs: [
                {
                  key: 'goal',
                  question: t('چه نتیجه‌ای می‌خواهید؟', 'What outcome do you want?'),
                  required: true,
                },
              ],
              stages: [
                {
                  key: 'clarify',
                  title: t('روشن‌سازی', 'Clarify'),
                  activity: 'clarify' as const,
                  inputKeys: ['goal'],
                  guidance: [
                    t('فقط ابهام ضروری را بپرس.', 'Ask only necessary clarifying questions.'),
                  ],
                },
              ],
              research: { mode: 'when-needed' as const, triggers: [] },
              outputs: [
                {
                  key: 'summary',
                  title: t('جمع‌بندی', 'Summary'),
                  sections: [t('هدف و اقدام بعدی', 'Goal and next action')],
                },
              ],
              qualityCriteria: [t('خروجی با هدف سازگار است', 'The output fits the goal')],
              boundaries: [t('اطلاعات نامعلوم جعل نمی‌شود', 'Unknown information is not invented')],
            };
    const result = await api<Pattern>('', 'POST', {
      definition: validation({ ...structuredClone(chosen), key: key.trim(), title: title.trim() }),
      idempotencyKey: crypto.randomUUID(),
    });
    await list();
    await open(result.id);
    setKey('');
    setTitle('');
  }
  async function save(value = draft) {
    if (!detail || !value) return;
    await api(`/${detail.pattern.id}/draft`, 'PUT', {
      expectedRevision: detail.pattern.revision,
      definition: validation(value),
    });
    await open(detail.pattern.id);
    await list();
    setNotice(
      t(
        'پیش‌نویس ذخیره شد. پیش از انتشار، همین ویرایش را آزمایش کنید.',
        'Draft saved. Preview this revision before publishing.',
      ),
    );
  }
  async function run(kind: 'chat' | 'test') {
    if (!detail || !consent || dirty) return;
    const abort = new AbortController();
    controller.current = abort;
    const result = await api<Run>(
      `/${detail.pattern.id}/${kind === 'chat' ? 'messages' : 'tests'}`,
      'POST',
      {
        content: kind === 'chat' ? question : sample,
        expectedRevision: detail.pattern.revision,
        providerConsent: true,
        idempotencyKey: crypto.randomUUID(),
      },
      abort.signal,
    );
    await open(detail.pattern.id);
    if (result.status !== 'complete')
      throw new Error(
        t(
          'درخواست هنوز کامل نشده است؛ تاریخچه را تازه‌سازی کنید.',
          'The request is not complete; refresh the history.',
        ),
      );
    if (kind === 'chat') setQuestion('');
    setConsent(false);
    controller.current = null;
  }
  async function publish() {
    if (!detail || !currentTest) return;
    await api(`/${detail.pattern.id}/versions`, 'POST', {
      expectedRevision: detail.pattern.revision,
      testRunId: currentTest.id,
      idempotencyKey: crypto.randomUUID(),
    });
    await open(detail.pattern.id);
    await list();
    setNotice(
      t(
        'نسخه منتشر شد. اتصال انتخاب الگو به پروژه در مرحلهٔ بعد انجام می‌شود.',
        'Version published. Project selection will be connected in the next stage.',
      ),
    );
  }
  function status(value: string) {
    return (
      (
        {
          draft: t('پیش‌نویس', 'Draft'),
          published: t('دارای نسخهٔ منتشرشده', 'Has published version'),
          archived: t('بایگانی‌شده', 'Archived'),
          complete: t('کامل', 'Complete'),
          pending: t('در انتظار پاسخ', 'Pending'),
          failed: t('ناموفق', 'Failed'),
        } as Record<string, string>
      )[value] ?? value
    );
  }

  return (
    <main className="patterns-page" dir={fa ? 'rtl' : 'ltr'}>
      <h1>{t('الگوهای مسئله', 'Problem patterns')}</h1>
      <p>
        {t(
          'با گفتگو یا ویرایش مستقیم، راهنمای اختیاری مسئله بسازید؛ ابتدا آزمایش و سپس منتشر کنید.',
          'Create optional problem guidance through conversation or direct editing; preview before publishing.',
        )}
      </p>
      {error && (
        <p role="alert" className="pattern-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">{t('در حال بارگذاری…', 'Loading…')}</p>}
      <div className="patterns-layout">
        <aside>
          <h2>{t('الگوها', 'Patterns')}</h2>
          <button disabled={busy || dirty} onClick={() => void action(list)}>
            {t('تازه‌سازی فهرست', 'Refresh list')}
          </button>
          {!loading && patterns.length === 0 && (
            <p>{t('هنوز الگویی نساخته‌اید.', 'No patterns yet.')}</p>
          )}
          <ul>
            {patterns.map((item) => (
              <li key={item.id}>
                <button
                  disabled={busy || dirty}
                  aria-pressed={detail?.pattern.id === item.id}
                  onClick={() => void action(() => open(item.id))}
                >
                  {item.title} · {status(item.status)}{' '}
                  {item.latest_version ? `· ${item.latest_version}` : ''}
                </button>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy || dirty}>
            <legend>{t('الگوی تازه', 'New pattern')}</legend>
            <label>
              {t('نقطهٔ شروع', 'Starting point')}
              <select value={seed} onChange={(event) => setSeed(event.target.value)}>
                <option value="blank">{t('ایدهٔ تازه', 'New idea')}</option>
                <option value="meeting">{t('نمونهٔ جلسه', 'Meeting example')}</option>
                <option value="marketing">
                  {t('نمونهٔ آزمایش مارکتینگ', 'Marketing experiment example')}
                </option>
              </select>
            </label>
            <label>
              {t('شناسهٔ انگلیسی ثابت', 'Stable English key')}
              <input
                dir="ltr"
                placeholder="my-pattern"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <label>
              {t('عنوان الگو', 'Pattern title')}
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <button disabled={!key.trim() || !title.trim()} onClick={() => void action(create)}>
              {t('ساخت پیش‌نویس', 'Create draft')}
            </button>
          </fieldset>
        </aside>
        {detail && draft ? (
          <section>
            <h2>{detail.pattern.definition.title}</h2>
            <p>
              {status(detail.pattern.status)} · {t('ویرایش', 'Revision')} {detail.pattern.revision}
            </p>
            <div className="pattern-actions">
              <button
                disabled={busy || dirty}
                onClick={() => void action(() => open(detail.pattern.id))}
              >
                {t('تازه‌سازی تاریخچه', 'Refresh history')}
              </button>
              <button
                disabled={busy || !dirty || archived}
                onClick={() => void action(() => save())}
              >
                {t('ذخیرهٔ تغییرات', 'Save changes')}
              </button>
              <button disabled={busy || !dirty} onClick={() => setDraft(detail.pattern.definition)}>
                {t('کنار گذاشتن تغییرات', 'Discard changes')}
              </button>
              <button
                disabled={busy || dirty || archived || !currentTest || alreadyPublished}
                onClick={() => void action(publish)}
              >
                {t('انتشار این ویرایش', 'Publish this revision')}
              </button>
              <button
                disabled={busy || dirty || archived}
                onClick={() =>
                  void action(async () => {
                    await api(`/${detail.pattern.id}/archive`, 'POST', {
                      expectedRevision: detail.pattern.revision,
                    });
                    await open(detail.pattern.id);
                    await list();
                  })
                }
              >
                {t('بایگانی الگو', 'Archive pattern')}
              </button>
            </div>
            {dirty && (
              <p role="status">
                {t(
                  'تغییرات ذخیره نشده‌اند. برای گفتگو، آزمایش یا انتشار ابتدا ذخیره کنید.',
                  'Unsaved changes. Save before chatting, previewing or publishing.',
                )}
              </p>
            )}
            <div className="pattern-workbench">
              <div>
                <h3>{t('گفتگو برای ساخت الگو', 'Authoring conversation')}</h3>
                <div
                  className="pattern-history"
                  aria-label={t('تاریخچهٔ گفتگو و آزمایش', 'Conversation and preview history')}
                >
                  {detail.runs.length === 0 && (
                    <p>
                      {t(
                        'ایده، تغییر دلخواه یا نمونهٔ مسئله را مطرح کنید.',
                        'Describe your idea, desired change or example problem.',
                      )}
                    </p>
                  )}
                  {detail.runs.map((item) => (
                    <article className="pattern-box" key={item.id}>
                      <h4>
                        {item.kind === 'chat' ? t('گفتگو', 'Conversation') : t('آزمایش', 'Preview')}{' '}
                        · {t('ویرایش', 'Revision')} {item.revision} · {status(item.status)}
                      </h4>
                      <p className="pattern-text">{item.content}</p>
                      {item.result && (
                        <>
                          <p className="pattern-text">{item.result.answer}</p>
                          {item.result.metadata && (
                            <small dir="ltr">
                              {item.result.metadata.provider} · {item.result.metadata.modelId}
                            </small>
                          )}
                          {item.result.definition && (
                            <div>
                              <h4>{t('پیشنهاد تغییر', 'Proposed change')}</h4>
                              <p>
                                {item.result.definition.title} — {item.result.definition.purpose}
                              </p>
                              <details>
                                <summary>
                                  {t('مقایسهٔ پیشنهاد و پیش‌نویس', 'Compare proposal and draft')}
                                </summary>
                                {(
                                  [
                                    'title',
                                    'purpose',
                                    'applicability',
                                    'inputs',
                                    'stages',
                                    'research',
                                    'outputs',
                                    'qualityCriteria',
                                    'boundaries',
                                  ] as const
                                )
                                  .filter(
                                    (field) =>
                                      JSON.stringify(item.result!.definition![field]) !==
                                      JSON.stringify(detail.pattern.definition[field]),
                                  )
                                  .map((field) => (
                                    <div key={field}>
                                      <strong>
                                        {
                                          {
                                            title: t('عنوان', 'Title'),
                                            purpose: t('هدف', 'Purpose'),
                                            applicability: t('کاربرد', 'Applicability'),
                                            inputs: t('ورودی‌ها', 'Inputs'),
                                            stages: t('مراحل', 'Stages'),
                                            research: t('تحقیق', 'Research'),
                                            outputs: t('خروجی‌ها', 'Outputs'),
                                            qualityCriteria: t('کیفیت', 'Quality'),
                                            boundaries: t('مرزها', 'Boundaries'),
                                          }[field]
                                        }
                                      </strong>
                                      <div className="pattern-comparison">
                                        <pre>
                                          {t('فعلی', 'Current') +
                                            '\n' +
                                            readable(field, detail.pattern.definition)}
                                        </pre>
                                        <pre>
                                          {t('پیشنهادی', 'Proposed') +
                                            '\n' +
                                            readable(field, item.result!.definition!)}
                                        </pre>
                                      </div>
                                    </div>
                                  ))}
                              </details>
                              <button
                                disabled={
                                  busy ||
                                  dirty ||
                                  archived ||
                                  item.revision !== detail.pattern.revision
                                }
                                onClick={() => {
                                  setDraft(item.result!.definition);
                                  setNotice(
                                    t(
                                      'پیشنهاد برای بازبینی وارد ویرایشگر شد؛ برای پذیرش، ذخیره کنید.',
                                      'Proposal loaded for review. Save to accept it.',
                                    ),
                                  );
                                }}
                              >
                                {t('بازبینی پیشنهاد در ویرایشگر', 'Review proposal in editor')}
                              </button>
                            </div>
                          )}
                          {item.result.preview && (
                            <div>
                              <h4>{t('پیش‌نمایش اجرای آزمایشی', 'Simulated preview')}</h4>
                              <ul>
                                {item.result.preview.questions.map((question, i) => (
                                  <li key={i}>{question}</li>
                                ))}
                              </ul>
                              <p>{item.result.preview.researchDecision}</p>
                              <p className="pattern-text">{item.result.preview.sampleOutput}</p>
                              <ul>
                                {item.result.preview.limitations.map((limitation, i) => (
                                  <li key={i}>{limitation}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                      {item.status === 'failed' && (
                        <p>
                          {t(
                            'پاسخ معتبر ذخیره نشد. می‌توانید درخواست تازه‌ای بفرستید.',
                            'No valid response was saved. You can send a new request.',
                          )}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
                {detail.nextRunCursor && (
                  <button
                    disabled={busy || dirty}
                    onClick={() =>
                      void action(async () => {
                        const older = await api<Detail>(
                          `/${detail.pattern.id}?before=${detail.nextRunCursor}`,
                        );
                        setDetail((current) =>
                          current
                            ? {
                                ...current,
                                runs: [
                                  ...older.runs.filter(
                                    (run) =>
                                      !current.runs.some((existing) => existing.id === run.id),
                                  ),
                                  ...current.runs,
                                ],
                                nextRunCursor: older.nextRunCursor ?? null,
                              }
                            : current,
                        );
                      })
                    }
                  >
                    {t('گفتگوها و آزمایش‌های قدیمی‌تر', 'Older conversations and previews')}
                  </button>
                )}
                <fieldset disabled={busy || dirty || archived}>
                  <legend>{t('گفتگو و آزمایش', 'Chat and preview')}</legend>
                  <label>
                    {t(
                      'پیام شما برای ساخت یا اصلاح الگو',
                      'Your message to build or refine the pattern',
                    )}
                    <textarea
                      rows={4}
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    {t(
                      'اجازه می‌دهم پیام یا نمونه، تعریف ذخیره‌شدهٔ الگو و بخش محدودی از تاریخچه برای پاسخ‌گویی به سرویس AI تنظیم‌شده ارسال شود.',
                      'I consent to sending my message or sample, the saved definition and limited history to the configured AI provider.',
                    )}
                  </label>
                  <button
                    disabled={!consent || !question.trim()}
                    onClick={() => void action(() => run('chat'))}
                  >
                    {t('ارسال پیام', 'Send message')}
                  </button>
                  <label>
                    {t(
                      'مسئلهٔ نمونه برای آزمایش — اطلاعات حساس وارد نکنید',
                      'Sample problem for preview — avoid sensitive data',
                    )}
                    <textarea
                      rows={4}
                      value={sample}
                      onChange={(event) => setSample(event.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <button
                    disabled={!consent || !sample.trim()}
                    onClick={() => void action(() => run('test'))}
                  >
                    {t('آزمایش این ویرایش', 'Preview this revision')}
                  </button>
                </fieldset>
                {busy && (
                  <p role="status">
                    {t('در حال انجام درخواست…', 'Processing…')}{' '}
                    <button
                      onClick={() => controller.current?.abort()}
                      disabled={!controller.current}
                    >
                      {t('لغو درخواست AI', 'Cancel AI request')}
                    </button>
                  </p>
                )}
                <h3>{t('نسخه‌های منتشرشده', 'Published versions')}</h3>
                <ul>
                  {detail.versions.map((version) => (
                    <li key={version.id}>
                      {t('نسخه', 'Version')} {version.version} · {t('ویرایش', 'Revision')}{' '}
                      {version.revision}
                      <button
                        disabled={busy || dirty}
                        onClick={() =>
                          void action(async () => {
                            setPublished(
                              await api<{ version: number; definition: Definition }>(
                                `/${detail.pattern.id}/versions/${version.id}`,
                              ),
                            );
                          })
                        }
                      >
                        {t('مشاهدهٔ نسخه', 'View version')}
                      </button>
                    </li>
                  ))}
                </ul>
                {published && (
                  <section className="pattern-box">
                    <h3>
                      {t('نسخهٔ منتشرشده', 'Published version')} {published.version}
                    </h3>
                    <button onClick={() => setPublished(null)}>{t('بستن', 'Close')}</button>
                    <PatternEditor
                      value={published.definition}
                      onChange={() => undefined}
                      disabled
                      fa={fa}
                    />
                  </section>
                )}
                <p>
                  {t(
                    'پیش‌نمایش، شبیه‌سازی است و به معنی تحقیق واقعی یا اثبات کیفیت نیست.',
                    'A preview is a simulation, not real research or proof of effectiveness.',
                  )}
                </p>
              </div>
              <div>
                <PatternEditor
                  value={draft}
                  onChange={setDraft}
                  disabled={busy || archived}
                  fa={fa}
                />
                <section
                  className="pattern-box"
                  aria-label={t('پیش‌نمایش الگو', 'Pattern preview')}
                >
                  <h3>{draft.title}</h3>
                  <p>{draft.purpose}</p>
                  <ol>
                    {draft.stages.map((stage, index) => (
                      <li key={index}>{stage.title}</li>
                    ))}
                  </ol>
                  {draft.outputs.map((output, index) => (
                    <div key={index}>
                      <h4>{output.title}</h4>
                      <ul>
                        {output.sections.map((section, i) => (
                          <li key={i}>{section}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              </div>
            </div>
          </section>
        ) : (
          <p>
            {t(
              'یک الگو انتخاب کنید یا پیش‌نویس تازه بسازید.',
              'Select a pattern or create a draft.',
            )}
          </p>
        )}
      </div>
    </main>
  );
}
