'use client';

import { useState, type ReactNode } from 'react';

import { useLocale } from './locale-context';

/** Tables with more rows than this show a pager; shorter ones render as they were. */
export const PAGE_SIZE = 10;

const labels = {
  fa: {
    nav: 'صفحه‌بندی جدول',
    range: (from: string, to: string, total: string) => `نمایش ${from} تا ${to} از ${total}`,
    page: (page: string, pages: string) => `صفحه ${page} از ${pages}`,
    previous: 'قبلی',
    next: 'بعدی',
    more: 'بارگذاری بیشتر',
  },
  en: {
    nav: 'Table pages',
    range: (from: string, to: string, total: string) => `Showing ${from}–${to} of ${total}`,
    page: (page: string, pages: string) => `Page ${page} of ${pages}`,
    previous: 'Previous',
    next: 'Next',
    more: 'Load more',
  },
} as const;

/**
 * Shows a long list ten rows at a time. `children` draws the table for the rows to show; the
 * pager under it moves between pages (Previous / Next) or appends the next ten rows to the
 * current page (Load more). A list of ten rows or fewer shows no pager at all.
 */
export function PagedRows<T>({
  rows,
  children,
}: {
  readonly rows: readonly T[];
  readonly children: (visible: readonly T[]) => ReactNode;
}) {
  const locale = useLocale();
  const text = labels[locale];
  const number = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US');
  const [position, setPosition] = useState({ start: 0, extra: 0 });
  const total = rows.length;
  if (total <= PAGE_SIZE) return <>{children(rows)}</>;

  const pages = Math.ceil(total / PAGE_SIZE);
  // A list that shrank (a filter, a removal) keeps the pager on a page that still exists.
  const lastStart = (pages - 1) * PAGE_SIZE;
  const start = Math.min(position.start, lastStart);
  const end = Math.min(total, start + PAGE_SIZE + (start === position.start ? position.extra : 0));
  const page = Math.floor(start / PAGE_SIZE) + 1;
  const go = (nextStart: number) => setPosition({ start: nextStart, extra: 0 });

  return (
    <>
      {children(rows.slice(start, end))}
      <nav className="table-pager" aria-label={text.nav}>
        <span role="status" className="table-pager-range">
          {text.range(number.format(start + 1), number.format(end), number.format(total))}
        </span>
        <div className="table-pager-controls">
          <button
            type="button"
            className="secondary-button"
            disabled={start === 0}
            onClick={() => go(Math.max(0, start - PAGE_SIZE))}
          >
            {text.previous}
          </button>
          <span>{text.page(number.format(page), number.format(pages))}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={end >= total}
            onClick={() => go(end)}
          >
            {text.next}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={end >= total}
            onClick={() =>
              setPosition({ start, extra: Math.min(total, end + PAGE_SIZE) - start - PAGE_SIZE })
            }
          >
            {text.more}
          </button>
        </div>
      </nav>
    </>
  );
}
