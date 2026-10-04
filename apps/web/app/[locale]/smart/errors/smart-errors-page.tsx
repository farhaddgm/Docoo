'use client';

import type { Locale } from '../../../i18n';
import { ErrorsExplorer } from '../../../smart/errors-explorer';
import { smartMessagesFor } from '../../../smart/messages';
import { SignedIn } from '../../signed-in';

export function SmartErrorsPage({ locale }: { locale: Locale }) {
  const text = smartMessagesFor(locale).pages;
  return (
    <SignedIn locale={locale} title={text.errorsTitle} subtitle={text.errorsSubtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <ErrorsExplorer locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}
