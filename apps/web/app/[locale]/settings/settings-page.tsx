'use client';

import type { Locale } from '../../i18n';
import { WorkspacePage } from '../workspace-page';
import { ScopedSettings } from './scoped-settings';
import { settingsMessages } from './settings-messages';

/** System settings (UX §2, ADR-0018): the workspace defaults every project starts from. */
export function SettingsPage({ locale }: { locale: Locale }) {
  const text = settingsMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => (
        <ScopedSettings
          locale={locale}
          workspaceId={workspaceId}
          scopeType="workspace"
          scopeId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}
