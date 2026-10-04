'use client';

import type { Locale } from '../../../i18n';
import { IssuesExplorer } from '../../../smart/issues-explorer';
import { smartMessagesFor } from '../../../smart/messages';
import { SignedIn } from '../../signed-in';

export function SmartIssuesPage({ locale }: { locale: Locale }) {
  const text = smartMessagesFor(locale).pages;
  return (
    <SignedIn locale={locale} title={text.issuesTitle} subtitle={text.issuesSubtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <IssuesExplorer locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}
