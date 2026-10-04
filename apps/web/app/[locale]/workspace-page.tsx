'use client';

import type { ReactNode } from 'react';

import type { Locale } from '../i18n';
import { reportMessagesFor } from '../report-messages';
import { SignedIn } from './signed-in';

/** Signed-in page body that needs the administrator's workspace; the first one is used. */
export function WorkspacePage({
  locale,
  title,
  subtitle,
  children,
}: {
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle: string;
  readonly children: (workspaceId: string) => ReactNode;
}) {
  const content = reportMessagesFor(locale);
  return (
    <SignedIn locale={locale} title={title} subtitle={subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          children(identity.workspaces[0].id)
        ) : (
          <p className="notice error">{content.loadFailed}</p>
        )
      }
    </SignedIn>
  );
}
