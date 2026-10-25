'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  defaultPolicy,
  policySections,
  type Account,
  type AccountPolicy,
  type AiUsage,
  type EffectiveAccess,
  type PolicySection,
  type SectionLevel,
} from '@docoo/contracts';

import { formatNumber } from '../i18n';

type Locale = 'fa' | 'en';

interface PolicyResponse {
  role: Account['role'];
  isOwner: boolean;
  policy: AccountPolicy;
  effective: EffectiveAccess;
  usage: AiUsage;
}

const copy = {
  fa: {
    title: 'دسترسی و محدودیت‌ها',
    ownerOnly: 'فقط مالک',
    intro:
      'نقش می‌گوید حساب «حداکثر» چه کاری می‌تواند بکند؛ اینجا همان را برای همین حساب محدودتر می‌کنید. تغییر از درخواست بعدی حساب اعمال می‌شود.',
    loading: 'در حال بارگذاری…',
    failed: 'ذخیره یا بارگذاری انجام نشد.',
    save: 'ذخیره',
    cancel: 'انصراف',
    presets: 'الگوهای آماده',
    presetFull: 'ویرایشگر کامل',
    presetCareful: 'ویرایشگر محتاط',
    presetView: 'فقط مشاهده',
    presetHint: 'الگو فقط فرم را پر می‌کند؛ با «ذخیره» اعمال می‌شود.',
    viewerNote:
      'مشاهده‌گر هیچ‌چیز را تغییر نمی‌دهد: ساخت، آپلود و هوش مصنوعی برایش همیشه بسته است و بخش‌ها حداکثر «مشاهده» می‌شوند.',
    creation: 'ساخت و بارگذاری',
    canCreateProjects: 'می‌تواند پروژه بسازد',
    maxProjects: 'حداکثر پروژه‌های ساخته‌شده',
    maxProjectsHint: 'خالی: بدون سقف',
    canCreateTopics: 'می‌تواند حوزه بسازد',
    canUploadFiles: 'می‌تواند فایل بارگذاری کند',
    sections: 'دسترسی به بخش‌ها',
    sectionsHint:
      'پیش‌فرض ویرایشگر «ویرایش» و پیش‌فرض مشاهده‌گر «مشاهده» است. «بدون دسترسی» بخش را پنهان و بسته می‌کند.',
    levels: { none: 'بدون دسترسی', view: 'مشاهده', edit: 'ویرایش' } as Record<SectionLevel, string>,
    sectionNames: {
      knowledge: 'دانش (منبع‌ها و دانش تأییدشده)',
      business: 'کسب‌وکار',
      agents: 'ایجنت‌ها',
      workflow: 'گردش‌کار: اجرا، تأیید و پاسخ به پرسش‌های تحلیل',
      documents: 'مستندها',
      topics: 'حوزه‌ها',
      audit: 'گزارش رویدادها',
    } as Record<PolicySection, string>,
    ai: 'هوش مصنوعی',
    aiEnabled: 'می‌تواند کاری را که به مدل نیاز دارد شروع کند',
    aiHint:
      'سقف‌ها هنگام شروع هر کار بررسی می‌شوند؛ کاری که شروع شده تمام می‌شود و مصرفش به بررسی بعدی می‌رسد. خالی: بدون سقف.',
    monthlyTokens: 'توکن در ماه (ورودی + خروجی)',
    monthlyCost: 'هزینه در ماه (دلار)',
    dailyCalls: 'فراخوانی مدل در روز',
    usage: 'مصرف',
    usedTokens: 'توکن این ماه',
    usedCost: 'هزینهٔ این ماه',
    usedCalls: 'فراخوانی امروز',
    ofLimit: 'از {limit}',
    account: 'حساب',
    expiresAt: 'دسترسی تا',
    expiresHint: 'پس از این زمان حساب وارد نمی‌شود و نشست‌هایش بسته می‌شود. خالی: بدون پایان.',
    note: 'یادداشت مالک',
    ownerAreas: 'فقط مالک',
    ownerAreasHint: 'این بخش‌ها برای ویرایشگر و مشاهده‌گر همیشه بسته‌اند و تنظیم‌پذیر نیستند:',
    areas: [
      'ارائه‌دهنده‌ها و کلیدهای مدل',
      'تنظیمات سامانه',
      'یکپارچگی‌ها و اسمارت',
      'نگهداشت و پاک‌سازی داده',
      'کاربران و ورود با جیمیل',
    ],
  },
  en: {
    title: 'Access and limits',
    ownerOnly: 'Owner only',
    intro:
      'The role says the most an account can ever do; here you narrow it for this account. A change applies from the account’s next request.',
    loading: 'Loading…',
    failed: 'Could not load or save.',
    save: 'Save',
    cancel: 'Cancel',
    presets: 'Ready-made settings',
    presetFull: 'Full editor',
    presetCareful: 'Careful editor',
    presetView: 'View only',
    presetHint: 'A preset only fills the form; Save applies it.',
    viewerNote:
      'A viewer never changes anything: creating, uploading and AI are always closed to it, and sections are at most “View”.',
    creation: 'Creating and uploading',
    canCreateProjects: 'May create projects',
    maxProjects: 'Most projects it may have created',
    maxProjectsHint: 'Empty: no limit',
    canCreateTopics: 'May create topics',
    canUploadFiles: 'May upload files',
    sections: 'Access to sections',
    sectionsHint:
      'An editor defaults to “Edit” and a viewer to “View”. “No access” hides and closes the section.',
    levels: { none: 'No access', view: 'View', edit: 'Edit' } as Record<SectionLevel, string>,
    sectionNames: {
      knowledge: 'Knowledge (sources and approved knowledge)',
      business: 'Business',
      agents: 'Agents',
      workflow: 'Workflow: running, approving and answering analysis questions',
      documents: 'Documents',
      topics: 'Topics',
      audit: 'Event log',
    } as Record<PolicySection, string>,
    ai: 'Artificial intelligence',
    aiEnabled: 'May start work that needs a model',
    aiHint:
      'Limits are checked when a piece of work starts; work already started finishes and its use counts for the next check. Empty: no limit.',
    monthlyTokens: 'Tokens per month (input + output)',
    monthlyCost: 'Spend per month (USD)',
    dailyCalls: 'Model calls per day',
    usage: 'Usage',
    usedTokens: 'Tokens this month',
    usedCost: 'Spend this month',
    usedCalls: 'Calls today',
    ofLimit: 'of {limit}',
    account: 'Account',
    expiresAt: 'Access until',
    expiresHint: 'After this moment the account cannot sign in and its sessions end. Empty: never.',
    note: 'Owner’s note',
    ownerAreas: 'Owner only',
    ownerAreasHint: 'These are always closed to editors and viewers and cannot be set:',
    areas: [
      'Providers and model keys',
      'System settings',
      'Integrations and Smart',
      'Data retention and purge',
      'Users and Gmail sign-in',
    ],
  },
} as const;

/** The crown the app uses wherever only the owner may go. */
function Crown({ label }: { label: string }) {
  return (
    <svg
      className="tab-crown"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5zM5 21h14" />
    </svg>
  );
}
export { Crown as OwnerCrown };

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

const roleLevel = (role: Account['role']): SectionLevel => (role === 'viewer' ? 'view' : 'edit');

/** A number field that is empty for "no limit". */
function Limit({
  label,
  value,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  step: number;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="policy-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        dir="ltr"
        min={0}
        step={step}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  shown,
}: {
  label: string;
  used: number;
  limit: number | null;
  shown: string;
}) {
  return (
    <div className="policy-meter">
      <span>{label}</span>
      <strong dir="ltr">{shown}</strong>
      {limit !== null && limit > 0 && (
        <meter
          min={0}
          max={limit}
          low={limit * 0.7}
          high={limit * 0.9}
          optimum={0}
          value={Math.min(used, limit)}
          aria-label={label}
        />
      )}
    </div>
  );
}

/** Owner-only: what one account may reach, create and spend (ADR-0042). */
export function AccountPolicyDialog({
  locale,
  user,
  onClose,
  onSaved,
}: {
  locale: Locale;
  user: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = copy[locale];
  const dialog = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState<PolicyResponse | null>(null);
  const [policy, setPolicy] = useState<AccountPolicy>(defaultPolicy());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const viewer = user.role === 'viewer';
  const base = roleLevel(user.role);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
      previous?.focus?.();
    };
    // Opened once per mount; `onClose` only closes it.
  }, []);

  useEffect(() => {
    let cancelled = false;
    void call<PolicyResponse>(`/owner/users/${user.id}/policy`)
      .then((value) => {
        if (cancelled) return;
        setLoaded(value);
        setPolicy(value.policy);
      })
      .catch(() => {
        if (!cancelled) setError(t.failed);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id, t.failed]);

  const level = (section: PolicySection): SectionLevel => policy.sections[section] ?? base;
  const setLevel = (section: PolicySection, value: SectionLevel) => {
    const rest = { ...policy.sections };
    // Only what differs from the role's default is stored.
    if (value === base) delete rest[section];
    else rest[section] = value;
    setPolicy({ ...policy, sections: rest });
  };
  const preset = (name: 'full' | 'careful' | 'view') => {
    const fresh = defaultPolicy();
    if (name === 'full') setPolicy({ ...fresh, canCreateProjects: true, canCreateTopics: true });
    else if (name === 'careful')
      setPolicy({
        ...fresh,
        canCreateProjects: true,
        maxProjects: 5,
        sections: { agents: 'view', audit: 'none', topics: 'view' },
        ai: { enabled: true, monthlyTokens: 500_000, monthlyCostUsd: 5, dailyCalls: 100 },
      });
    else
      setPolicy({
        ...fresh,
        canUploadFiles: false,
        sections: {},
        ai: { ...fresh.ai, enabled: false },
      });
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await call(`/owner/users/${user.id}/policy`, 'PUT', policy);
      onSaved();
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  }

  // The date field works in local time; the policy keeps an exact moment.
  const expiryValue = policy.expiresAt
    ? new Date(new Date(policy.expiresAt).getTime() - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : '';
  const usage = loaded?.usage;
  const num = (value: number) => formatNumber(locale, value);

  return (
    <div className="account-modal-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-dialog-title"
        className="card account-dialog policy-dialog"
      >
        <h2 id="policy-dialog-title">
          {t.title} · {user.displayName}
          <Crown label={t.ownerOnly} />
        </h2>
        <p className="muted">{t.intro}</p>
        {!loaded && !error && <p role="status">{t.loading}</p>}
        {loaded && (
          <form className="stack" onSubmit={(event) => void save(event)}>
            {viewer && <p className="notice">{t.viewerNote}</p>}

            <div className="policy-presets" role="group" aria-label={t.presets}>
              <span>{t.presets}</span>
              {!viewer && (
                <>
                  <button type="button" className="secondary-button" onClick={() => preset('full')}>
                    {t.presetFull}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => preset('careful')}
                  >
                    {t.presetCareful}
                  </button>
                </>
              )}
              <button type="button" className="secondary-button" onClick={() => preset('view')}>
                {t.presetView}
              </button>
            </div>
            <small className="muted">{t.presetHint}</small>

            <fieldset className="policy-group">
              <legend>{t.creation}</legend>
              <label className="account-checkbox">
                <input
                  type="checkbox"
                  checked={!viewer && policy.canCreateProjects}
                  disabled={viewer}
                  onChange={(e) => setPolicy({ ...policy, canCreateProjects: e.target.checked })}
                />
                {t.canCreateProjects}
              </label>
              <Limit
                label={`${t.maxProjects} (${t.maxProjectsHint})`}
                value={policy.maxProjects}
                step={1}
                disabled={viewer || !policy.canCreateProjects}
                onChange={(value) =>
                  setPolicy({ ...policy, maxProjects: value === null ? null : Math.max(1, value) })
                }
              />
              <label className="account-checkbox">
                <input
                  type="checkbox"
                  checked={!viewer && policy.canCreateTopics}
                  disabled={viewer}
                  onChange={(e) => setPolicy({ ...policy, canCreateTopics: e.target.checked })}
                />
                {t.canCreateTopics}
              </label>
              <label className="account-checkbox">
                <input
                  type="checkbox"
                  checked={!viewer && policy.canUploadFiles}
                  disabled={viewer}
                  onChange={(e) => setPolicy({ ...policy, canUploadFiles: e.target.checked })}
                />
                {t.canUploadFiles}
              </label>
            </fieldset>

            <fieldset className="policy-group">
              <legend>{t.sections}</legend>
              <small className="muted">{t.sectionsHint}</small>
              <ul className="policy-sections">
                {policySections.map((section) => (
                  <li key={section}>
                    <label htmlFor={`policy-${section}`}>{t.sectionNames[section]}</label>
                    <select
                      id={`policy-${section}`}
                      value={level(section)}
                      onChange={(e) => setLevel(section, e.target.value as SectionLevel)}
                    >
                      <option value="none">{t.levels.none}</option>
                      <option value="view">{t.levels.view}</option>
                      {!viewer && <option value="edit">{t.levels.edit}</option>}
                    </select>
                  </li>
                ))}
              </ul>
              <p className="policy-owner-areas">
                <Crown label={t.ownerAreas} /> <strong>{t.ownerAreas}</strong> {t.ownerAreasHint}
              </p>
              <ul className="policy-owner-list">
                {t.areas.map((area) => (
                  <li key={area}>{area}</li>
                ))}
              </ul>
            </fieldset>

            <fieldset className="policy-group">
              <legend>{t.ai}</legend>
              <label className="account-checkbox">
                <input
                  type="checkbox"
                  checked={!viewer && policy.ai.enabled}
                  disabled={viewer}
                  onChange={(e) =>
                    setPolicy({ ...policy, ai: { ...policy.ai, enabled: e.target.checked } })
                  }
                />
                {t.aiEnabled}
              </label>
              <small className="muted">{t.aiHint}</small>
              <div className="policy-limits">
                <Limit
                  label={t.monthlyTokens}
                  value={policy.ai.monthlyTokens}
                  step={10_000}
                  disabled={viewer || !policy.ai.enabled}
                  onChange={(value) =>
                    setPolicy({ ...policy, ai: { ...policy.ai, monthlyTokens: value } })
                  }
                />
                <Limit
                  label={t.monthlyCost}
                  value={policy.ai.monthlyCostUsd}
                  step={1}
                  disabled={viewer || !policy.ai.enabled}
                  onChange={(value) =>
                    setPolicy({ ...policy, ai: { ...policy.ai, monthlyCostUsd: value } })
                  }
                />
                <Limit
                  label={t.dailyCalls}
                  value={policy.ai.dailyCalls}
                  step={10}
                  disabled={viewer || !policy.ai.enabled}
                  onChange={(value) =>
                    setPolicy({ ...policy, ai: { ...policy.ai, dailyCalls: value } })
                  }
                />
              </div>
              {usage && (
                <div className="policy-usage" aria-label={t.usage}>
                  <Meter
                    label={t.usedTokens}
                    used={usage.monthTokens}
                    limit={policy.ai.monthlyTokens}
                    shown={`${num(usage.monthTokens)}${policy.ai.monthlyTokens === null ? '' : ` ${t.ofLimit.replace('{limit}', num(policy.ai.monthlyTokens))}`}`}
                  />
                  <Meter
                    label={t.usedCost}
                    used={usage.monthCostUsd}
                    limit={policy.ai.monthlyCostUsd}
                    shown={`$${usage.monthCostUsd.toFixed(2)}${policy.ai.monthlyCostUsd === null ? '' : ` ${t.ofLimit.replace('{limit}', `$${policy.ai.monthlyCostUsd}`)}`}`}
                  />
                  <Meter
                    label={t.usedCalls}
                    used={usage.todayCalls}
                    limit={policy.ai.dailyCalls}
                    shown={`${num(usage.todayCalls)}${policy.ai.dailyCalls === null ? '' : ` ${t.ofLimit.replace('{limit}', num(policy.ai.dailyCalls))}`}`}
                  />
                </div>
              )}
            </fieldset>

            <fieldset className="policy-group">
              <legend>{t.account}</legend>
              <div className="policy-field">
                <label htmlFor="policy-expires">{t.expiresAt}</label>
                <input
                  id="policy-expires"
                  type="datetime-local"
                  dir="ltr"
                  value={expiryValue}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
                <small className="muted">{t.expiresHint}</small>
              </div>
              <div className="policy-field">
                <label htmlFor="policy-note">{t.note}</label>
                <textarea
                  id="policy-note"
                  rows={2}
                  maxLength={500}
                  value={policy.note}
                  onChange={(e) => setPolicy({ ...policy, note: e.target.value })}
                />
              </div>
            </fieldset>

            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <div className="accounts-actions">
              <button type="submit" className="primary-button" disabled={busy}>
                {t.save}
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
                {t.cancel}
              </button>
            </div>
          </form>
        )}
        {error && !loaded && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
