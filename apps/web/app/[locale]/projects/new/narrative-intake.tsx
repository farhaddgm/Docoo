'use client';

import { useState } from 'react';
import { highlightSegments, type IntakeDraft } from '@docoo/contracts';

import { apiSend } from '../../../api-client';
import { textDir, type Locale } from '../../../i18n';
import { DictateButton } from '../../../voice/dictate-button';
import { appendTranscript } from '../../../voice/voice-helpers';

export interface IntakeFill {
  title: string;
  initialProblem: string;
  description: string;
}

const words = {
  fa: {
    title: 'روایت صوتی مسئله',
    intro:
      'مسئله را یک تا سه دقیقه بگویید (یا چند بار ضبط کنید؛ هر بار به متن اضافه می‌شود). متن رونویسی‌شده منبع حقیقت می‌ماند: سامانه فقط پیش‌نویس می‌سازد و هر چه می‌گوید «شنیدم» را به جملهٔ خودتان پیوند می‌دهد.',
    transcript: 'رونویسی (قابل‌ویرایش)',
    make: 'ساخت پیش‌نویس از روایت',
    making: 'در حال ساخت پیش‌نویس…',
    tooShort: 'روایت هنوز کوتاه است؛ چند جمله‌ی دیگر بگویید.',
    failed: 'پیش‌نویس ساخته نشد. دوباره تلاش کنید.',
    reviewTitle: 'اعداد و نام‌ها را بررسی کنید',
    reviewHelp:
      'تشخیص گفتار فارسی در عدد و نام بیشتر خطا می‌کند. هر چیز رنگی را با آنچه گفته‌اید مقایسه کنید و در متن بالا اصلاح کنید.',
    legendFigure: 'عدد یا مبلغ',
    legendName: 'نام',
    heard: 'گفته‌اید',
    goal: 'هدف',
    facts: 'واقعیت‌هایی که گفتید',
    constraints: 'محدودیت‌ها',
    assumptions: 'استنباط سامانه (شما نگفتید)',
    assumptionsHelp: 'این‌ها را سامانه حدس زده؛ اگر درست نیستند حذف کنید.',
    missing: 'سؤال‌هایی که روایت جواب نداد',
    missingHelp: 'با «حالت سریع» می‌توانید فقط همین‌ها را پاسخ دهید.',
    dropped: (n: string) => `${n} مورد حذف شد چون در روایت شما پیدا نشد.`,
    fields: { title: 'عنوان', problem: 'مسئله', description: 'توضیح' },
    confirm: 'اعداد و نام‌های رنگی را بررسی کردم',
    apply: 'استفاده در فرم',
    applyExpress: 'استفاده در فرم و انتخاب پیش‌نویس فوری',
    applyExpressHelp:
      'پیش‌نویس فوری فقط دربارهٔ پنج چیز می‌پرسد؛ آنچه در روایت گفته‌اید دیگر پرسیده نمی‌شود.',
    applied: 'در فرم گذاشته شد؛ پیش از ساخت پروژه بخوانید و ویرایش کنید.',
  },
  en: {
    title: 'Tell the problem aloud',
    intro:
      'Tell the problem for one to three minutes (or record several times; each adds to the text). The transcript stays the source of truth: the system only drafts, and ties everything it says it “heard” to your own sentence.',
    transcript: 'Transcript (editable)',
    make: 'Draft the project from the story',
    making: 'Drafting…',
    tooShort: 'The story is still short; say a few more sentences.',
    failed: 'The draft could not be made. Try again.',
    reviewTitle: 'Check the numbers and names',
    reviewHelp:
      'Speech recognition errs most on numbers and names. Compare each coloured item with what you said and fix it in the text above.',
    legendFigure: 'Number or amount',
    legendName: 'Name',
    heard: 'You said',
    goal: 'Goal',
    facts: 'Facts you stated',
    constraints: 'Constraints',
    assumptions: 'Inferred by the system (you did not say)',
    assumptionsHelp: 'The system guessed these; remove any that is not right.',
    missing: 'Questions the story did not answer',
    missingHelp: 'With “Quick draft” you can answer only these.',
    dropped: (n: string) => `${n} item(s) were dropped because they were not in your story.`,
    fields: { title: 'Title', problem: 'Problem', description: 'Description' },
    confirm: 'I checked the coloured numbers and names',
    apply: 'Use in the form',
    applyExpress: 'Use in the form and choose the express draft',
    applyExpressHelp:
      'The express draft asks about five things only; what you said in the story is not asked again.',
    applied: 'Put in the form; read and edit it before creating the project.',
  },
};

/** NXT-008: a spoken story becomes a reviewed draft of the first wizard step. Nothing is saved. */
export function NarrativeIntake({
  locale,
  workspaceId,
  onApply,
}: {
  locale: Locale;
  workspaceId: string;
  onApply: (fill: IntakeFill, options?: { express?: boolean }) => void;
}) {
  const t = words[locale];
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [fields, setFields] = useState({ title: '', problem: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'short' | 'failed' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [applied, setApplied] = useState(false);
  const needsReview = draft ? draft.figures.length + draft.names.length > 0 : false;

  async function make() {
    if (transcript.trim().length < 40) return setProblem('short');
    setBusy(true);
    setProblem(null);
    setApplied(false);
    try {
      const { draft: made } = await apiSend<{ draft: IntakeDraft }>(
        'POST',
        `/workspaces/${workspaceId}/project-intake`,
        { transcript: transcript.trim(), locale },
      );
      setDraft(made);
      setFields({ title: made.title, problem: made.problem, description: made.description });
      setConfirmed(false);
    } catch {
      setDraft(null);
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  }

  const segments = draft ? highlightSegments(transcript.trim(), draft.figures, draft.names) : [];
  // The draft was made from the trimmed text; if the person edits it afterwards, the marks are stale.
  const stale = draft !== null && segments.map((s) => s.text).join('') !== transcript.trim();

  return (
    <details className="card stack" open>
      <summary>
        <strong>{t.title}</strong>
      </summary>
      <p className="muted">{t.intro}</p>
      <div className="field">
        <label htmlFor="intake-transcript">{t.transcript}</label>
        <textarea
          id="intake-transcript"
          dir={textDir(locale)}
          rows={6}
          value={transcript}
          maxLength={20000}
          onChange={(event) => setTranscript(event.target.value)}
        />
      </div>
      <DictateButton
        locale={locale}
        workspaceId={workspaceId}
        disabled={busy}
        onText={(text) => setTranscript((current) => appendTranscript(current, text))}
      />
      <div className="toolbar">
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void make()}
        >
          {busy ? t.making : t.make}
        </button>
      </div>
      {problem && (
        <p className="notice error" role="alert">
          {problem === 'short' ? t.tooShort : t.failed}
        </p>
      )}

      {draft && (
        <div className="stack">
          {needsReview && (
            <div className="stack">
              <h3>{t.reviewTitle}</h3>
              <p className="muted">{t.reviewHelp}</p>
              <p dir={textDir(locale)}>
                {stale
                  ? transcript
                  : segments.map((segment, index) =>
                      segment.mark === 'plain' ? (
                        <span key={index}>{segment.text}</span>
                      ) : (
                        <mark
                          key={index}
                          className={segment.mark === 'figure' ? 'mark-figure' : 'mark-name'}
                        >
                          {segment.text}
                        </mark>
                      ),
                    )}
              </p>
              <p className="muted">
                <small>
                  <mark className="mark-figure">{t.legendFigure}</mark>{' '}
                  <mark className="mark-name">{t.legendName}</mark>
                </small>
              </p>
            </div>
          )}

          {(['title', 'problem', 'description'] as const).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`intake-${key}`}>{t.fields[key]}</label>
              {key === 'title' ? (
                <input
                  id={`intake-${key}`}
                  dir={textDir(locale)}
                  value={fields[key]}
                  onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                />
              ) : (
                <textarea
                  id={`intake-${key}`}
                  dir={textDir(locale)}
                  rows={key === 'problem' ? 5 : 2}
                  value={fields[key]}
                  onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                />
              )}
            </div>
          ))}

          {draft.goal && (
            <p dir={textDir(locale)}>
              <strong>{t.goal}:</strong> {draft.goal.text}{' '}
              <small className="muted">
                ({t.heard}: «{draft.goal.quote}»)
              </small>
            </p>
          )}
          {draft.facts.length > 0 && (
            <div>
              <h3>{t.facts}</h3>
              <ul className="output-list" dir={textDir(locale)}>
                {draft.facts.map((item, index) => (
                  <li key={index}>
                    {item.text}{' '}
                    <small className="muted">
                      ({t.heard}: «{item.quote}»)
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.constraints.length > 0 && (
            <div>
              <h3>{t.constraints}</h3>
              <ul className="output-list" dir={textDir(locale)}>
                {draft.constraints.map((item, index) => (
                  <li key={index}>
                    {item.text}{' '}
                    <small className="muted">
                      ({t.heard}: «{item.quote}»)
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.assumptions.length > 0 && (
            <div>
              <h3>{t.assumptions}</h3>
              <p className="muted">{t.assumptionsHelp}</p>
              <ul className="output-list" dir={textDir(locale)}>
                {draft.assumptions.map((item, index) => (
                  <li key={index}>{item.text}</li>
                ))}
              </ul>
            </div>
          )}
          {draft.missing.length > 0 && (
            <div>
              <h3>{t.missing}</h3>
              <p className="muted">{t.missingHelp}</p>
              <ul className="output-list" dir={textDir(locale)}>
                {draft.missing.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {draft.dropped > 0 && (
            <p className="muted">
              <small>{t.dropped(String(draft.dropped))}</small>
            </p>
          )}

          {needsReview && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{' '}
              {t.confirm}
            </label>
          )}
          <div className="toolbar">
            {([false, true] as const).map((express) => (
              <button
                key={String(express)}
                className={express ? 'secondary-button' : 'primary-button'}
                type="button"
                disabled={
                  (needsReview && !confirmed) ||
                  fields.title.trim() === '' ||
                  fields.problem.trim() === ''
                }
                onClick={() => {
                  onApply(
                    {
                      title: fields.title.trim(),
                      initialProblem: fields.problem.trim(),
                      description: fields.description.trim(),
                    },
                    { express },
                  );
                  setApplied(true);
                }}
              >
                {express ? t.applyExpress : t.apply}
              </button>
            ))}
          </div>
          <p className="muted">
            <small>{t.applyExpressHelp}</small>
          </p>
          {applied && (
            <p className="notice info" role="status">
              {t.applied}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
