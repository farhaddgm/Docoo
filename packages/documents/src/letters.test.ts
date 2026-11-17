import { describe, expect, it } from 'vitest';
import { documentDateLine } from './jalali.js';
import { renderDocx } from './docx.js';
import { renderHtml } from './html.js';
import { buildMeetingMinutes, buildOfficialLetter } from './letters.js';

const when = '2026-11-17T09:00:00Z';

describe('official letter', () => {
  const letter = buildOfficialLetter({
    language: 'fa',
    number: '۱۴۰۵/۱۲۳',
    date: when,
    subject: 'درخواست جلسه',
    recipient: { name: 'خانم احمدی', title: 'مدیر مالی', organization: 'شرکت نمونه' },
    sender: { name: 'رضا کریمی', title: 'مدیرعامل' },
    body: ['یک بند.', '  ', 'بند دوم.'],
    attachments: ['گزارش'],
    copies: ['بایگانی'],
  });
  it('has the parts of a Persian letter in order, with a Jalali date', () => {
    const texts = letter.blocks.map((b) =>
      b.type === 'paragraph' ? b.runs.map((r) => r.text).join('') : b.type,
    );
    expect(texts.slice(0, 8)).toEqual([
      'شماره: ۱۴۰۵/۱۲۳',
      'تاریخ: ۲۶ آبان ۱۴۰۵',
      'پیوست: دارد',
      'به: مدیر مالی خانم احمدی شرکت نمونه',
      'موضوع: درخواست جلسه',
      'با سلام و احترام',
      'یک بند.',
      'بند دوم.',
    ]);
    expect(texts).toContain('با احترام');
    expect(letter.title).toBe('درخواست جلسه');
  });
  it('requires a subject, a body, a recipient and a sender', () => {
    const base = {
      language: 'fa' as const,
      date: when,
      subject: 's',
      recipient: { name: 'r' },
      sender: { name: 'x' },
      body: ['b'],
    };
    expect(() => buildOfficialLetter({ ...base, subject: ' ' })).toThrow(/subject/u);
    expect(() => buildOfficialLetter({ ...base, body: [' '] })).toThrow(/body/u);
    expect(() => buildOfficialLetter({ ...base, recipient: { name: '' } })).toThrow(/recipient/u);
    expect(() => buildOfficialLetter({ ...base, sender: { name: '' } })).toThrow(/sender/u);
  });
  it('writes an English letter with an ISO date and no attachment', () => {
    const en = buildOfficialLetter({
      language: 'en',
      date: when,
      subject: 'Meeting',
      recipient: { name: 'Ms Ahmadi' },
      sender: { name: 'R. Karimi' },
      body: ['Hello.'],
    });
    const first = en.blocks.map((b) =>
      b.type === 'paragraph' ? b.runs.map((r) => r.text).join('') : '',
    );
    expect(first[0]).toBe('Number: —');
    expect(first[1]).toBe('Date: 2026-11-17');
    expect(first[2]).toBe('Attachments: None');
  });
});

describe('meeting minutes', () => {
  it('numbers decisions in Persian digits and shows owners and Jalali due dates', () => {
    const minutes = buildMeetingMinutes({
      language: 'fa',
      title: 'بودجه',
      date: when,
      attendees: ['الف', 'ب'],
      agenda: ['بررسی'],
      decisions: [{ text: 'تأیید', owner: 'الف', due: '2026-12-01T00:00:00Z' }, { text: 'پیگیری' }],
    });
    const table = minutes.blocks.find((b) => b.type === 'table');
    expect(table && table.type === 'table' ? table.rows : null).toEqual([
      ['۱', 'تأیید', 'الف', '۱۰ آذر ۱۴۰۵'],
      ['۲', 'پیگیری', '—', '—'],
    ]);
    expect(minutes.title).toBe('صورت‌جلسه: بودجه');
  });
  it('needs attendees', () => {
    expect(() =>
      buildMeetingMinutes({
        language: 'fa',
        title: 't',
        date: when,
        attendees: [],
        agenda: [],
        decisions: [],
      }),
    ).toThrow(/attendee/u);
  });
});

describe('dated rendering', () => {
  const doc = buildOfficialLetter({
    language: 'fa',
    date: when,
    subject: 'موضوع',
    recipient: { name: 'a' },
    sender: { name: 'b' },
    body: ['متن'],
  });
  it('puts the Jalali version date under the title and renders the same bytes twice', () => {
    expect(documentDateLine('fa', when, 3)).toBe('تاریخ نسخه: ۲۶ آبان ۱۴۰۵ · نسخهٔ ۳');
    expect(documentDateLine('en', when, 3)).toBe('Version date: 2026-11-17 · Version 3');
    const html = renderHtml(doc, { documentId: 'd', version: 3, createdAt: when });
    expect(html).toContain('تاریخ نسخه: ۲۶ آبان ۱۴۰۵');
    expect(renderHtml(doc, { documentId: 'd', version: 3 })).not.toContain('doc-meta">');
    const meta = { documentId: 'd', version: 3, createdAt: when };
    expect(Buffer.from(renderDocx(doc, meta)).equals(Buffer.from(renderDocx(doc, meta)))).toBe(
      true,
    );
  });
});
