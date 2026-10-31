'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { ApiError, apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

type Kind = 'strategy_document' | 'product_documentation' | 'technical_prototype';

interface Item {
  kind: Kind;
  title: string;
  purpose: string;
  scopeIn: string;
  scopeOut: string;
}

interface Plan {
  id: string;
  versionNo: number;
  source: 'system' | 'ai' | 'admin';
  items: Item[];
  confirmed: { at: string } | null;
}

interface Data {
  plan: Plan | null;
  /** What the administrator expected when creating the project (ADR-0043); empty when not said. */
  expectedOutput?: string;
  required: boolean;
  kinds: { kind: Kind; supported: boolean }[];
  waiting: boolean;
}

const copy = {
  fa: {
    title: 'خروجی‌های موردانتظار',
    help: 'پیش از ایده‌پردازی مشخص کنید چه خروجی‌هایی می‌خواهید. ایده‌پردازی تا تأیید شما منتظر می‌ماند و سپس فقط برای همین خروجی‌ها کار می‌کند.',
    waiting: 'ایده‌پردازی منتظر تأیید این فهرست است.',
    expectedOutput: 'آنچه هنگام ساخت پروژه به‌عنوان خروجی مورد انتظار نوشتید',
    empty: 'هنوز خروجی‌ای تعیین نشده است.',
    confirmed: 'تأییدشده در {at}',
    unconfirmed: 'تأیید نشده',
    version: 'نسخهٔ {n}',
    sources: { system: 'خالی', ai: 'پیشنهاد هوش مصنوعی', admin: 'ویرایش ادمین' },
    kinds: {
      strategy_document: 'سند راهبردی',
      product_documentation: 'مستندات محصول',
      technical_prototype: 'کد یا نمونهٔ فنی',
    },
    outside: 'خارج از Docoo: Docoo سند می‌سازد، نه کد؛ این مورد فقط در فهرست می‌ماند.',
    purpose: 'هدف',
    scopeIn: 'داخل محدوده',
    scopeOut: 'خارج از محدوده',
    itemTitle: 'عنوان',
    kind: 'نوع',
    propose: 'پیشنهاد با هوش مصنوعی',
    proposing: 'در حال نوشتن پیشنهاد…',
    proposeNote: 'پیشنهاد تازه نسخهٔ جدیدی می‌سازد و باید دوباره تأیید شود.',
    edit: 'ویرایش فهرست',
    add: 'افزودن مورد',
    remove: 'حذف',
    save: 'ذخیرهٔ نسخهٔ جدید',
    cancel: 'انصراف',
    confirm: 'تأیید خروجی‌ها',
    confirming: 'در حال تأیید…',
    needSupported: 'برای تأیید دست‌کم یک سند راهبردی یا مستندات محصول لازم است.',
    errors: {
      AI_NOT_CONFIGURED: 'هوش مصنوعی هنوز تنظیم نشده است.',
      DELIVERABLES_PROPOSAL_FAILED: 'پیشنهاد ساخته نشد. دوباره تلاش کنید یا خودتان بنویسید.',
      DELIVERABLES_VERSION_CONFLICT: 'فهرست در این فاصله تغییر کرد؛ صفحه را تازه کنید.',
      DELIVERABLES_ALREADY_CONFIRMED: 'این فهرست قبلاً تأیید شده است.',
      DELIVERABLES_NOTHING_TO_PRODUCE:
        'برای تأیید دست‌کم یک سند راهبردی یا مستندات محصول لازم است.',
      DELIVERABLES_INVALID_REQUEST: 'هر مورد نوع و عنوان معتبر لازم دارد.',
    } as Record<string, string>,
    generic: 'انجام نشد. دوباره تلاش کنید.',
    loadFailed: 'فهرست خروجی‌ها بارگذاری نشد.',
  },
  en: {
    title: 'Expected deliverables',
    help: 'Say which outputs you expect before ideation. Ideation waits for your confirmation and then works for these outputs only.',
    waiting: 'Ideation is waiting for this list to be confirmed.',
    expectedOutput: 'What you wrote as the expected output when creating the project',
    empty: 'No deliverable has been set yet.',
    confirmed: 'Confirmed {at}',
    unconfirmed: 'Not confirmed',
    version: 'Version {n}',
    sources: { system: 'Empty', ai: 'AI proposal', admin: 'Edited by an administrator' },
    kinds: {
      strategy_document: 'Strategy document',
      product_documentation: 'Product documentation',
      technical_prototype: 'Code or technical prototype',
    },
    outside: 'Outside Docoo: Docoo writes documents, not code; this item stays on the list only.',
    purpose: 'Purpose',
    scopeIn: 'In scope',
    scopeOut: 'Out of scope',
    itemTitle: 'Title',
    kind: 'Kind',
    propose: 'Propose with AI',
    proposing: 'Writing a proposal…',
    proposeNote: 'A new proposal makes a new version that must be confirmed again.',
    edit: 'Edit the list',
    add: 'Add an item',
    remove: 'Remove',
    save: 'Save as a new version',
    cancel: 'Cancel',
    confirm: 'Confirm the deliverables',
    confirming: 'Confirming…',
    needSupported: 'Confirming needs at least one strategy document or product documentation.',
    errors: {
      AI_NOT_CONFIGURED: 'AI is not configured yet.',
      DELIVERABLES_PROPOSAL_FAILED:
        'No proposal could be made. Try again or write the list yourself.',
      DELIVERABLES_VERSION_CONFLICT: 'The list changed meanwhile; reload the page.',
      DELIVERABLES_ALREADY_CONFIRMED: 'This list is already confirmed.',
      DELIVERABLES_NOTHING_TO_PRODUCE:
        'Confirming needs at least one strategy document or product documentation.',
      DELIVERABLES_INVALID_REQUEST: 'Every item needs a valid kind and a title.',
    } as Record<string, string>,
    generic: 'It did not work. Try again.',
    loadFailed: 'The list of deliverables could not be loaded.',
  },
} as const;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
const blank = (): Item => ({
  kind: 'strategy_document',
  title: '',
  purpose: '',
  scopeIn: '',
  scopeOut: '',
});

/**
 * ADR-0031: the plan of expected deliverables, shown on the workflow tab. Ideation waits for
 * its confirmation; editing or proposing makes a new version that needs confirming again.
 */
export function DeliverablesPanel({
  locale,
  base,
  onChanged,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  onChanged: () => Promise<void>;
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<'propose' | 'save' | 'confirm' | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Data>(`${base}/deliverables`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  function explain(caught: unknown): string {
    return (caught instanceof ApiError && caught.code && text.errors[caught.code]) || text.generic;
  }

  async function act(kind: 'propose' | 'save' | 'confirm', work: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      await work();
    } catch (caught) {
      setError(explain(caught));
    } finally {
      setBusy(null);
      await load();
    }
  }

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
  if (!data || (!data.required && !data.plan)) return null;

  const plan = data.plan;
  const supported = (kind: Kind) =>
    data.kinds.find((item) => item.kind === kind)?.supported ?? false;
  const canConfirm = Boolean(
    plan && !plan.confirmed && plan.items.some((item) => supported(item.kind)),
  );

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.title}</h2>
      <p className="muted">{text.help}</p>
      {data.waiting && !plan?.confirmed && (
        <p className="notice" role="status">
          {text.waiting}
        </p>
      )}
      {data.expectedOutput && (
        <figure className="stack" aria-label={text.expectedOutput}>
          <figcaption className="muted">{text.expectedOutput}</figcaption>
          <blockquote dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {data.expectedOutput}
          </blockquote>
        </figure>
      )}
      {plan && (
        <p className="muted">
          {fill(text.version, { n: formatNumber(locale, plan.versionNo) })} ·{' '}
          {text.sources[plan.source]} ·{' '}
          {plan.confirmed
            ? fill(text.confirmed, { at: formatDateTime(locale, plan.confirmed.at) })
            : text.unconfirmed}
        </p>
      )}

      {draft ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void act('save', async () => {
              await apiSend('PUT', `${base}/deliverables`, {
                items: draft,
                basedOnVersionNo: plan?.versionNo ?? 0,
              });
              setDraft(null);
            });
          }}
        >
          {draft.map((item, index) => (
            <fieldset key={index} className="field-stack">
              <legend>{formatNumber(locale, index + 1)}</legend>
              <label htmlFor={`${id}-kind-${index}`}>{text.kind}</label>
              <select
                id={`${id}-kind-${index}`}
                value={item.kind}
                onChange={(event) =>
                  setDraft(
                    draft.map((row, at) =>
                      at === index ? { ...row, kind: event.target.value as Kind } : row,
                    ),
                  )
                }
              >
                {data.kinds.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {text.kinds[option.kind]}
                    {option.supported
                      ? ''
                      : ` — ${locale === 'fa' ? 'خارج از Docoo' : 'outside Docoo'}`}
                  </option>
                ))}
              </select>
              {(
                [
                  ['title', text.itemTitle, 200],
                  ['purpose', text.purpose, 2000],
                  ['scopeIn', text.scopeIn, 2000],
                  ['scopeOut', text.scopeOut, 2000],
                ] as const
              ).map(([field, label, max]) => (
                <div key={field} className="field-stack">
                  <label htmlFor={`${id}-${field}-${index}`}>{label}</label>
                  {field === 'title' ? (
                    <input
                      id={`${id}-${field}-${index}`}
                      dir={textDir(locale)}
                      maxLength={max}
                      value={item[field]}
                      required
                      onChange={(event) =>
                        setDraft(
                          draft.map((row, at) =>
                            at === index ? { ...row, [field]: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    <textarea
                      id={`${id}-${field}-${index}`}
                      dir={textDir(locale)}
                      rows={2}
                      maxLength={max}
                      value={item[field]}
                      onChange={(event) =>
                        setDraft(
                          draft.map((row, at) =>
                            at === index ? { ...row, [field]: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              ))}
              <div className="toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={draft.length <= 1}
                  onClick={() => setDraft(draft.filter((_, at) => at !== index))}
                >
                  {text.remove}
                </button>
              </div>
            </fieldset>
          ))}
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={draft.length >= 20}
              onClick={() => setDraft([...draft, blank()])}
            >
              {text.add}
            </button>
            <button className="primary-button" type="submit" disabled={busy !== null}>
              {text.save}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => setDraft(null)}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      ) : (
        <>
          {!plan || plan.items.length === 0 ? (
            <p className="muted">{text.empty}</p>
          ) : (
            <ol className="plain-list">
              {plan.items.map((item, index) => (
                <li key={index}>
                  <strong dir={textDir(locale)}>{item.title}</strong>{' '}
                  <span className="badge">{text.kinds[item.kind]}</span>
                  {!supported(item.kind) && <p className="muted">{text.outside}</p>}
                  {item.purpose && (
                    <p dir={textDir(locale)}>
                      <small className="muted">{text.purpose}: </small>
                      {item.purpose}
                    </p>
                  )}
                  {item.scopeIn && (
                    <p dir={textDir(locale)}>
                      <small className="muted">{text.scopeIn}: </small>
                      {item.scopeIn}
                    </p>
                  )}
                  {item.scopeOut && (
                    <p dir={textDir(locale)}>
                      <small className="muted">{text.scopeOut}: </small>
                      {item.scopeOut}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!readOnly && (
            <div className="stack">
              <div className="toolbar">
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null || Boolean(plan?.confirmed)}
                  onClick={() =>
                    void act('propose', async () => {
                      await apiSend('POST', `${base}/deliverables/propose`);
                    })
                  }
                >
                  {busy === 'propose' ? text.proposing : text.propose}
                </button>
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    setDraft(
                      plan && plan.items.length > 0
                        ? plan.items.map((item) => ({ ...item }))
                        : [blank()],
                    )
                  }
                >
                  {text.edit}
                </button>
                <button
                  data-write-action
                  className="primary-button"
                  type="button"
                  disabled={busy !== null || !canConfirm}
                  onClick={() =>
                    void act('confirm', async () => {
                      await apiSend(
                        'POST',
                        `${base}/deliverables/confirm`,
                        { versionNo: plan!.versionNo },
                        { headers: { 'idempotency-key': idempotencyKey() } },
                      );
                      await onChanged();
                    })
                  }
                >
                  {busy === 'confirm' ? text.confirming : text.confirm}
                </button>
              </div>
              {!plan?.confirmed && <small className="muted">{text.proposeNote}</small>}
              {plan && !plan.confirmed && !canConfirm && plan.items.length > 0 && (
                <small className="muted">{text.needSupported}</small>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
