'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../../../api-client';
import { formatDateTime, type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

interface Source {
  ref: string;
  title: string;
  url: string | null;
  kind: 'knowledge' | 'official' | 'public';
}

interface Decision {
  decision: 'trust' | 'dismiss';
  trustedRef: string | null;
  note: string;
  createdAt: string;
}

interface Conflict {
  fingerprint: string;
  description: string;
  sources: Source[];
  decision: Decision | null;
}

interface Data {
  items: Conflict[];
}

const copy = {
  fa: {
    title: 'تعارض‌های تحقیق',
    help: 'جایی که منابع با هم نمی‌خوانند، شما تصمیم بگیرید: یکی از منابع را معتبر بدانید یا تعارض را بی‌اهمیت اعلام کنید. تصمیم شما برای مرحله‌های بعد (ایده، مستند، ارزیابی) الزام‌آور است و با دور تکمیلی هم می‌ماند.',
    undecided: 'تصمیم‌گیری نشده',
    trusted: 'معتبر دانسته شد: {source}',
    dismissed: 'بی‌اهمیت اعلام شد',
    decidedAt: 'در {at}',
    trust: 'این را معتبر بدان',
    dismiss: 'این تعارض مهم نیست',
    note: 'یادداشت (اختیاری)',
    kinds: { knowledge: 'دانش تأییدشده', official: 'وب رسمی', public: 'وب عمومی' },
    change: 'تغییر تصمیم',
    cancel: 'انصراف',
    errors: {
      RESEARCH_CONFLICT_NOT_FOUND: 'این تعارض دیگر در خروجی نیست؛ صفحه را تازه کنید.',
      RESEARCH_CONFLICT_INVALID: 'یکی از منبع‌های همین تعارض را انتخاب کنید.',
    } as Record<string, string>,
    generic: 'انجام نشد. دوباره تلاش کنید.',
  },
  en: {
    title: 'Research conflicts',
    help: 'Where sources disagree, you decide: trust one of the sources or dismiss the conflict as unimportant. Your decision is binding for the later stages (ideas, documents, evaluation) and stays through a follow-up round.',
    undecided: 'Not decided',
    trusted: 'Trusted: {source}',
    dismissed: 'Dismissed as unimportant',
    decidedAt: 'on {at}',
    trust: 'Trust this one',
    dismiss: 'This conflict does not matter',
    note: 'Note (optional)',
    kinds: { knowledge: 'Approved knowledge', official: 'Official web', public: 'Public web' },
    change: 'Change the decision',
    cancel: 'Cancel',
    errors: {
      RESEARCH_CONFLICT_NOT_FOUND: 'This conflict is no longer in the output; reload the page.',
      RESEARCH_CONFLICT_INVALID: 'Choose one of the sources of this conflict.',
    } as Record<string, string>,
    generic: 'It did not work. Try again.',
  },
} as const;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

/** Only http(s) addresses become links; a provider's page address is data, not trusted markup. */
const safeUrl = (value: string | null): string | null =>
  value && /^https?:\/\//iu.test(value) ? value : null;

function SourceLabel({ locale, source }: { locale: Locale; source: Source }) {
  const text = copy[locale];
  const url = safeUrl(source.url);
  return (
    <>
      <strong>{source.ref}</strong>{' '}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" dir={textDir(locale)}>
          {source.title || url}
        </a>
      ) : (
        <span dir={textDir(locale)}>{source.title}</span>
      )}{' '}
      <span className={`badge ${source.kind === 'public' ? 'tone-warn' : 'tone-neutral'}`}>
        {text.kinds[source.kind]}
      </span>
    </>
  );
}

/**
 * ADR-0040: the conflicts the research reported. The administrator decides each one — trust one
 * of its sources, or dismiss it — and the later stages treat the decision as binding.
 */
export function ResearchConflictsPanel({
  locale,
  base,
  refreshKey = 0,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  refreshKey?: number;
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Data>(`${base}/research-conflicts`));
    } catch {
      setData(null);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function decide(
    conflict: Conflict,
    body: { decision: 'trust' | 'dismiss'; trustedRef?: string },
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiSend('POST', `${base}/research-conflicts/${conflict.fingerprint}/decision`, {
        ...body,
        ...(notes[conflict.fingerprint]?.trim()
          ? { note: notes[conflict.fingerprint]!.trim() }
          : {}),
      });
      setChanging(null);
    } catch (caught) {
      setError(
        (caught instanceof ApiError && caught.code && text.errors[caught.code]) || text.generic,
      );
    } finally {
      setBusy(false);
      await load();
    }
  }

  if (!data || data.items.length === 0) return null;

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.title}</h2>
      <p className="muted">{text.help}</p>
      <ol className="plain-list">
        {data.items.map((conflict) => {
          const decided = conflict.decision;
          const open = !decided || changing === conflict.fingerprint;
          const trusted = decided?.trustedRef
            ? conflict.sources.find((source) => source.ref === decided.trustedRef)
            : undefined;
          return (
            <li key={conflict.fingerprint} className="stack">
              <p dir={textDir(locale)}>{conflict.description}</p>
              <ul className="plain-list">
                {conflict.sources.map((source) => (
                  <li key={source.ref}>
                    <SourceLabel locale={locale} source={source} />
                    {open && !readOnly && (
                      <>
                        {' '}
                        <button
                          data-write-action
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void decide(conflict, { decision: 'trust', trustedRef: source.ref })
                          }
                        >
                          {text.trust}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {decided && (
                <p role="status">
                  <span
                    className={`badge ${decided.decision === 'trust' ? 'tone-ok' : 'tone-neutral'}`}
                  >
                    {decided.decision === 'trust'
                      ? fill(text.trusted, { source: trusted?.ref ?? decided.trustedRef ?? '' })
                      : text.dismissed}
                  </span>{' '}
                  <small className="muted">
                    {fill(text.decidedAt, { at: formatDateTime(locale, decided.createdAt) })}
                    {decided.note && ` — ${decided.note}`}
                  </small>
                </p>
              )}
              {!decided && <p className="muted">{text.undecided}</p>}
              {open && !readOnly && (
                <div className="field-stack">
                  <label htmlFor={`${id}-note-${conflict.fingerprint}`}>{text.note}</label>
                  <input
                    id={`${id}-note-${conflict.fingerprint}`}
                    dir={textDir(locale)}
                    maxLength={500}
                    value={notes[conflict.fingerprint] ?? ''}
                    onChange={(event) =>
                      setNotes({ ...notes, [conflict.fingerprint]: event.target.value })
                    }
                  />
                  <div className="toolbar compact">
                    <button
                      data-write-action
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(conflict, { decision: 'dismiss' })}
                    >
                      {text.dismiss}
                    </button>
                    {decided && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={() => setChanging(null)}
                      >
                        {text.cancel}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {decided && !open && !readOnly && (
                <div className="toolbar compact">
                  <button
                    data-write-action
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setChanging(conflict.fingerprint)}
                  >
                    {text.change}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
