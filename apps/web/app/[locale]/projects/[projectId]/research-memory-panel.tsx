'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../../../api-client';
import { type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

type State =
  | { index: number; state: 'saveable' }
  | { index: number; state: 'saved'; knowledgeId: string }
  | { index: number; state: 'blocked'; reason: string };

type Confidentiality = 'internal' | 'confidential' | 'restricted';

const copy = {
  fa: {
    title: 'ذخیره در دانش سازمان',
    help: 'یافته‌های تأییدشده‌ای که منبع وب دارند را می‌توانید به‌صورت پیش‌نویس به دانش سازمان بسپارید تا پروژه‌های بعدی از همین‌جا شروع کنند و دوباره جست‌وجو نکنند. پیش‌نویس باید در صفحهٔ دانش ممیزی شود تا تحقیق‌ها بتوانند به آن تکیه کنند.',
    confidentiality: 'سطح محرمانگی',
    levels: { internal: 'داخلی', confidential: 'محرمانه', restricted: 'ممنوع‌انتشار' } as Record<
      string,
      string
    >,
    confidentialityHelp:
      'اگر یافته از دانش محرمانه‌تری کمک گرفته باشد، سامانه خودش سطح را بالاتر می‌برد؛ هرگز پایین‌تر نمی‌آید.',
    save: 'ذخیره در دانش',
    saving: 'در حال ذخیره…',
    saved: 'ذخیره شد',
    openKnowledge: 'باز کردن در صفحهٔ دانش (برای ممیزی)',
    done: 'ذخیره شد. برای استفادهٔ تحقیق‌ها، در صفحهٔ دانش آن را برای ممیزی بفرستید.',
    none: 'یافتهٔ قابل ذخیره‌ای نیست.',
    blocked:
      '{n} یافته قابل ذخیره نیست: بدون منبع وب تأییدشده، مورد اختلاف، یا اطلاعاتشان قدیمی است.',
    errors: {
      RESEARCH_MEMORY_ALREADY_SAVED: 'این یافته قبلاً ذخیره شده است؛ صفحه را تازه کنید.',
      RESEARCH_MEMORY_NOT_ALLOWED: 'این یافته دیگر قابل ذخیره نیست؛ صفحه را تازه کنید.',
    } as Record<string, string>,
    generic: 'ذخیره نشد. دوباره تلاش کنید.',
  },
  en: {
    title: 'Keep in the organization knowledge',
    help: 'Verified findings that rest on a web page can be kept as a draft of the organization knowledge, so later projects start from them instead of searching again. The draft must be audited on the Knowledge page before research can rely on it.',
    confidentiality: 'Confidentiality',
    levels: {
      internal: 'Internal',
      confidential: 'Confidential',
      restricted: 'Restricted',
    } as Record<string, string>,
    confidentialityHelp:
      'If the finding drew on more confidential knowledge, the system raises the level itself; it is never lowered.',
    save: 'Keep in knowledge',
    saving: 'Keeping…',
    saved: 'Kept',
    openKnowledge: 'Open on the Knowledge page (to audit it)',
    done: 'Kept. To let research use it, send it for audit on the Knowledge page.',
    none: 'No finding can be kept.',
    blocked:
      '{n} finding(s) cannot be kept: no verified web page, in dispute, or the information is old.',
    errors: {
      RESEARCH_MEMORY_ALREADY_SAVED: 'This finding is already kept; reload the page.',
      RESEARCH_MEMORY_NOT_ALLOWED: 'This finding can no longer be kept; reload the page.',
    } as Record<string, string>,
    generic: 'It was not kept. Try again.',
  },
} as const;

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/**
 * ADR-0053: keeps a verified finding of this research as a draft of the organization's knowledge.
 * Only findings the server says are keepable get a button; what cannot be kept is counted, not hidden.
 */
export function ResearchMemoryPanel({
  locale,
  base,
  outputId,
  claims,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  outputId: string;
  /** The claim text of each finding of the output, by index. */
  claims: readonly string[];
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [items, setItems] = useState<State[] | null>(null);
  const [confidentiality, setConfidentiality] = useState<Confidentiality>('internal');
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await apiGet<{ items: State[] }>(
        `${base}/research-memory?outputId=${outputId}`,
      );
      setItems(result.items);
    } catch {
      setItems(null);
    }
  }, [base, outputId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function keep(index: number) {
    if (busy !== null) return;
    setBusy(index);
    setError('');
    setNotice('');
    try {
      await apiSend('POST', `${base}/research-memory`, {
        outputId,
        findingIndex: index,
        confidentiality,
      });
      setNotice(text.done);
    } catch (caught) {
      setError(
        (caught instanceof ApiError && caught.code && text.errors[caught.code]) || text.generic,
      );
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (items === null) return null;
  const saveable = items.filter((item) => item.state !== 'blocked');
  const blocked = items.length - saveable.length;
  if (saveable.length === 0 && blocked === 0) return null;

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{text.title}</h3>
      <p className="muted">{text.help}</p>
      {saveable.length === 0 ? (
        <p className="muted">{text.none}</p>
      ) : (
        <>
          {!readOnly && (
            <div className="field-stack">
              <label htmlFor={`${id}-level`}>{text.confidentiality}</label>
              <select
                id={`${id}-level`}
                value={confidentiality}
                onChange={(event) => setConfidentiality(event.target.value as Confidentiality)}
              >
                {(['internal', 'confidential', 'restricted'] as const).map((level) => (
                  <option key={level} value={level}>
                    {text.levels[level]}
                  </option>
                ))}
              </select>
              <small className="muted">{text.confidentialityHelp}</small>
            </div>
          )}
          <ul className="plain-list">
            {saveable.map((item) => (
              <li key={item.index} className="stack">
                <p dir={textDir(locale)}>{clip(claims[item.index] ?? '', 240)}</p>
                {item.state === 'saved' ? (
                  <p>
                    <span className="badge tone-ok">{text.saved}</span>{' '}
                    <Link href={`/${locale}/knowledge/${item.knowledgeId}` as Route}>
                      {text.openKnowledge}
                    </Link>
                  </p>
                ) : (
                  !readOnly && (
                    <div>
                      <button
                        data-write-action
                        type="button"
                        className="secondary-button"
                        disabled={busy !== null}
                        onClick={() => void keep(item.index)}
                      >
                        {busy === item.index ? text.saving : text.save}
                      </button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {blocked > 0 && <p className="muted">{text.blocked.replace('{n}', String(blocked))}</p>}
      {notice && (
        <p className="notice info" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
