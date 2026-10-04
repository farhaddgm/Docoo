'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

import type { Locale } from '../i18n';
import { smartMessagesFor } from './messages';

/** Switch between the two full Smart pages. */
export function SmartSubnav({ locale }: { locale: Locale }) {
  const text = smartMessagesFor(locale);
  const pathname = usePathname();
  const items = [
    { href: `/${locale}/smart/errors`, label: text.pages.errors },
    { href: `/${locale}/smart/issues`, label: text.pages.issues },
  ];
  return (
    <nav aria-label={text.pages.subnav} className="toolbar smart-subnav">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href as Route}
          className={
            pathname === item.href ? 'primary-button link-button' : 'secondary-button link-button'
          }
          aria-current={pathname === item.href ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
