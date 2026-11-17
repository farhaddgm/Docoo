import { formatJalali, tehranDay, toPersianDigits } from './jalali.js';
import type { Block, StructuredDocument } from './model.js';

/**
 * Official letter and meeting minutes (NXT-003): the two paper forms a Persian-speaking manager
 * still has to produce. They are built from fields the manager types, never from a model, so a
 * name, a number or a date can not be changed by a generator. Both come out as ordinary structured
 * documents and so export to DOCX and PDF like every other document.
 */
export interface Party {
  readonly name: string;
  readonly title?: string | undefined;
  readonly organization?: string | undefined;
}

export interface LetterInput {
  readonly language: 'fa' | 'en';
  /** The letter number as the organisation writes it, e.g. “۱۴۰۵/۱۲۳”. Optional until it is registered. */
  readonly number?: string | undefined;
  /** An instant; the date shown is that day in Tehran (Jalali for Persian). */
  readonly date: string;
  readonly subject: string;
  readonly recipient: Party;
  readonly sender: Party;
  /** One entry per paragraph. */
  readonly body: readonly string[];
  readonly attachments?: readonly string[] | undefined;
  readonly copies?: readonly string[] | undefined;
}

export interface MinutesInput {
  readonly language: 'fa' | 'en';
  readonly title: string;
  readonly date: string;
  readonly place?: string | undefined;
  readonly attendees: readonly string[];
  readonly agenda: readonly string[];
  readonly decisions: readonly {
    readonly text: string;
    readonly owner?: string | undefined;
    /** An instant; shown as that day. */
    readonly due?: string | undefined;
  }[];
  readonly nextMeeting?: string | undefined;
}

const labels = {
  fa: {
    number: 'شماره',
    date: 'تاریخ',
    attachments: 'پیوست',
    hasAttachments: 'دارد',
    noAttachments: 'ندارد',
    to: 'به',
    subject: 'موضوع',
    greeting: 'با سلام و احترام',
    closing: 'با احترام',
    copies: 'رونوشت',
    attachmentList: 'فهرست پیوست‌ها',
    place: 'محل',
    attendees: 'حاضران',
    agenda: 'دستور جلسه',
    decisions: 'مصوبات',
    columns: ['ردیف', 'مصوبه', 'مسئول', 'مهلت'] as const,
    decisionsCaption: 'مصوبات جلسه',
    nextMeeting: 'جلسهٔ بعد',
    minutes: 'صورت‌جلسه',
  },
  en: {
    number: 'Number',
    date: 'Date',
    attachments: 'Attachments',
    hasAttachments: 'Yes',
    noAttachments: 'None',
    to: 'To',
    subject: 'Subject',
    greeting: 'Dear Sir or Madam,',
    closing: 'Yours sincerely,',
    copies: 'Copies',
    attachmentList: 'List of attachments',
    place: 'Place',
    attendees: 'Attendees',
    agenda: 'Agenda',
    decisions: 'Decisions',
    columns: ['No.', 'Decision', 'Owner', 'Due'] as const,
    decisionsCaption: 'Decisions of the meeting',
    nextMeeting: 'Next meeting',
    minutes: 'Meeting minutes',
  },
} as const;

function day(language: 'fa' | 'en', value: string): string {
  if (language === 'fa') return formatJalali(value);
  const d = tehranDay(value);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

const num = (language: 'fa' | 'en', value: number) =>
  language === 'fa' ? toPersianDigits(String(value)) : String(value);

const party = (p: Party) => [p.title, p.name, p.organization].filter(Boolean).join(' ');

const labelled = (id: string, label: string, value: string): Block => ({
  type: 'paragraph',
  id,
  runs: [{ text: `${label}: `, bold: true }, { text: value }],
});

const text = (id: string, value: string): Block => ({
  type: 'paragraph',
  id,
  runs: [{ text: value }],
});

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function buildOfficialLetter(input: LetterInput): StructuredDocument {
  const l = labels[input.language];
  const subject = required(input.subject, 'subject');
  const body = input.body.map((p) => p.trim()).filter(Boolean);
  if (body.length === 0) throw new Error('The body is required.');
  const attachments = (input.attachments ?? []).map((a) => a.trim()).filter(Boolean);
  const copies = (input.copies ?? []).map((c) => c.trim()).filter(Boolean);
  const blocks: Block[] = [
    labelled('letter-number', l.number, input.number?.trim() || '—'),
    labelled('letter-date', l.date, day(input.language, input.date)),
    labelled(
      'letter-attachments',
      l.attachments,
      attachments.length ? l.hasAttachments : l.noAttachments,
    ),
    labelled(
      'letter-to',
      l.to,
      party({ ...input.recipient, name: required(input.recipient.name, 'recipient') }),
    ),
    labelled('letter-subject', l.subject, subject),
    text('letter-greeting', l.greeting),
    ...body.map((p, i) => text(`letter-body-${i + 1}`, p)),
    text('letter-closing', l.closing),
    {
      type: 'paragraph',
      id: 'letter-signature',
      runs: [
        {
          text: party({ ...input.sender, name: required(input.sender.name, 'sender') }),
          bold: true,
        },
      ],
    },
  ];
  if (attachments.length) {
    blocks.push(
      { type: 'heading', id: 'letter-attachments-heading', level: 3, text: l.attachmentList },
      { type: 'list', id: 'letter-attachments-list', ordered: true, items: attachments },
    );
  }
  if (copies.length) {
    blocks.push(
      { type: 'heading', id: 'letter-copies-heading', level: 3, text: l.copies },
      { type: 'list', id: 'letter-copies-list', ordered: false, items: copies },
    );
  }
  return { title: subject, language: input.language, blocks };
}

export function buildMeetingMinutes(input: MinutesInput): StructuredDocument {
  const l = labels[input.language];
  const title = required(input.title, 'title');
  const attendees = input.attendees.map((a) => a.trim()).filter(Boolean);
  const agenda = input.agenda.map((a) => a.trim()).filter(Boolean);
  const decisions = input.decisions.filter((d) => d.text.trim());
  if (attendees.length === 0) throw new Error('At least one attendee is required.');
  const blocks: Block[] = [
    labelled('minutes-date', l.date, day(input.language, input.date)),
    ...(input.place?.trim() ? [labelled('minutes-place', l.place, input.place.trim())] : []),
    { type: 'heading', id: 'minutes-attendees-heading', level: 2, text: l.attendees },
    { type: 'list', id: 'minutes-attendees', ordered: false, items: attendees },
  ];
  if (agenda.length) {
    blocks.push(
      { type: 'heading', id: 'minutes-agenda-heading', level: 2, text: l.agenda },
      { type: 'list', id: 'minutes-agenda', ordered: true, items: agenda },
    );
  }
  if (decisions.length) {
    blocks.push(
      { type: 'heading', id: 'minutes-decisions-heading', level: 2, text: l.decisions },
      {
        type: 'table',
        id: 'minutes-decisions',
        caption: l.decisionsCaption,
        columns: l.columns,
        rows: decisions.map((d, i) => [
          num(input.language, i + 1),
          d.text.trim(),
          d.owner?.trim() || '—',
          d.due ? day(input.language, d.due) : '—',
        ]),
      },
    );
  }
  if (input.nextMeeting) {
    blocks.push(labelled('minutes-next', l.nextMeeting, day(input.language, input.nextMeeting)));
  }
  return { title: `${l.minutes}: ${title}`, language: input.language, blocks };
}
