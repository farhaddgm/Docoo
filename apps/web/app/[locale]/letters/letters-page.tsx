'use client';

import { useState, type FormEvent } from 'react';

import { apiPost, ApiError } from '../../api-client';
import type { Locale } from '../../i18n';
import { WorkspacePage } from '../workspace-page';

type Kind = 'letter' | 'minutes';

const FIELDS = [
  'date',
  'number',
  'subject',
  'recipient',
  'recipientTitle',
  'recipientOrg',
  'sender',
  'senderTitle',
  'body',
  'attachments',
  'copies',
  'meetingTitle',
  'place',
  'attendees',
  'agenda',
  'decisions',
] as const;
type Field = (typeof FIELDS)[number];

const words = {
  fa: {
    title: 'نامه و صورت‌جلسه',
    subtitle: 'قالب رسمی فارسی با تاریخ شمسی؛ خروجی DOCX از همان فیلدهایی که شما می‌نویسید',
    kind: 'نوع سند',
    kinds: { letter: 'نامهٔ اداری', minutes: 'صورت‌جلسه' } as Record<Kind, string>,
    date: 'تاریخ (میلادی؛ در سند شمسی نوشته می‌شود)',
    number: 'شماره نامه',
    subject: 'موضوع',
    recipient: 'گیرنده',
    recipientTitle: 'سمت گیرنده',
    recipientOrg: 'سازمان گیرنده',
    sender: 'فرستنده',
    senderTitle: 'سمت فرستنده',
    body: 'متن (هر بند در یک خط)',
    attachments: 'پیوست‌ها (هر مورد در یک خط)',
    copies: 'رونوشت (هر مورد در یک خط)',
    meetingTitle: 'عنوان جلسه',
    place: 'محل',
    attendees: 'حاضران (هر نفر در یک خط)',
    agenda: 'دستور جلسه (هر مورد در یک خط)',
    decisions:
      'مصوبات (هر مصوبه در یک خط؛ «متن | مسئول | تاریخ مهلت میلادی» مثل «تأیید بودجه | رضا | 2026-12-01»)',
    make: 'ساخت و دریافت DOCX',
    making: 'در حال ساخت…',
    failed: 'ساخت انجام نشد. فیلدهای ضروری را بررسی کنید.',
    note: 'متن را شما می‌نویسید و سامانه هیچ بخشی را نمی‌سازد یا عوض نمی‌کند. چیزی ذخیره نمی‌شود.',
  },
  en: {
    title: 'Letter and meeting minutes',
    subtitle: 'An official Persian form with a Jalali date; a DOCX from the fields you write',
    kind: 'Kind of document',
    kinds: { letter: 'Official letter', minutes: 'Meeting minutes' } as Record<Kind, string>,
    date: 'Date (Gregorian; written as Jalali in the document)',
    number: 'Letter number',
    subject: 'Subject',
    recipient: 'Recipient',
    recipientTitle: 'Recipient’s title',
    recipientOrg: 'Recipient’s organisation',
    sender: 'Sender',
    senderTitle: 'Sender’s title',
    body: 'Body (one paragraph per line)',
    attachments: 'Attachments (one per line)',
    copies: 'Copies (one per line)',
    meetingTitle: 'Meeting title',
    place: 'Place',
    attendees: 'Attendees (one per line)',
    agenda: 'Agenda (one per line)',
    decisions:
      'Decisions (one per line; “text | owner | due date” such as “Approve budget | Reza | 2026-12-01”)',
    make: 'Build and download DOCX',
    making: 'Building…',
    failed: 'It could not be built. Check the required fields.',
    note: 'You write the text; the system never writes or changes any part of it. Nothing is stored.',
  },
};

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const today = () => new Date().toISOString().slice(0, 10);

function Letters({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const t = words[locale];
  const [kind, setKind] = useState<Kind>('letter');
  const [f, setF] = useState<Record<Field, string>>(() => ({
    ...(Object.fromEntries(FIELDS.map((field) => [field, ''])) as Record<Field, string>),
    date: today(),
  }));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (key: Field) => (event: { target: { value: string } }) =>
    setF((previous) => ({ ...previous, [key]: event.target.value }));

  function input(id: Field, label: string, required = false) {
    return (
      <div className="field">
        <label htmlFor={`l-${id}`}>{label}</label>
        <input id={`l-${id}`} value={f[id]} onChange={set(id)} required={required} />
      </div>
    );
  }
  function area(id: Field, label: string, required = false) {
    return (
      <div className="field">
        <label htmlFor={`l-${id}`}>{label}</label>
        <textarea id={`l-${id}`} rows={4} value={f[id]} onChange={set(id)} required={required} />
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    const at = `${f.date || today()}T09:00:00+03:30`;
    const body =
      kind === 'letter'
        ? {
            kind,
            language: locale,
            ...(f.number ? { number: f.number } : {}),
            date: at,
            subject: f.subject,
            recipient: { name: f.recipient, title: f.recipientTitle, organization: f.recipientOrg },
            sender: { name: f.sender, title: f.senderTitle },
            body: lines(f.body),
            attachments: lines(f.attachments),
            copies: lines(f.copies),
          }
        : {
            kind,
            language: locale,
            title: f.meetingTitle,
            date: at,
            ...(f.place ? { place: f.place } : {}),
            attendees: lines(f.attendees),
            agenda: lines(f.agenda),
            decisions: lines(f.decisions).map((line) => {
              const [text = '', owner, due] = line.split('|').map((part) => part.trim());
              return {
                text,
                ...(owner ? { owner } : {}),
                ...(due && /^\d{4}-\d{2}-\d{2}$/u.test(due)
                  ? { due: `${due}T09:00:00+03:30` }
                  : {}),
              };
            }),
          };
    try {
      const response = await apiPost(`/workspaces/${workspaceId}/letters/export`, body);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 400) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor="l-kind">{t.kind}</label>
        <select id="l-kind" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
          {(['letter', 'minutes'] as const).map((value) => (
            <option key={value} value={value}>
              {t.kinds[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="l-date">{t.date}</label>
        <input id="l-date" type="date" value={f.date} onChange={set('date')} required />
      </div>
      {kind === 'letter' ? (
        <>
          {input('number', t.number)}
          {input('subject', t.subject, true)}
          {input('recipient', t.recipient, true)}
          {input('recipientTitle', t.recipientTitle)}
          {input('recipientOrg', t.recipientOrg)}
          {input('sender', t.sender, true)}
          {input('senderTitle', t.senderTitle)}
          {area('body', t.body, true)}
          {area('attachments', t.attachments)}
          {area('copies', t.copies)}
        </>
      ) : (
        <>
          {input('meetingTitle', t.meetingTitle, true)}
          {input('place', t.place)}
          {area('attendees', t.attendees, true)}
          {area('agenda', t.agenda)}
          {area('decisions', t.decisions)}
        </>
      )}
      {failed && (
        <p className="notice error" role="alert">
          {t.failed}
        </p>
      )}
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? t.making : t.make}
        </button>
      </div>
      <p className="muted">
        <small>{t.note}</small>
      </p>
    </form>
  );
}

export function LettersPage({ locale }: { locale: Locale }) {
  const t = words[locale];
  return (
    <WorkspacePage locale={locale} title={t.title} subtitle={t.subtitle}>
      {(workspaceId) => <Letters locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}
