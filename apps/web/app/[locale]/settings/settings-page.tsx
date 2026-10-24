'use client';

import type { Locale } from '../../i18n';
import { Integrations } from '../integrations/integrations-page';
import { Templates } from '../templates/templates-page';
import { WorkspacePage } from '../workspace-page';
import { ScopedSettings } from './scoped-settings';
import { settingsMessages } from './settings-messages';

/** System settings (UX §2, ADR-0018): the workspace defaults every project starts from. */
export function SettingsPage({ locale }: { locale: Locale }) {
  const text = settingsMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => (
        <div className="stack">
          <Templates locale={locale} workspaceId={workspaceId} showSettingsLink={false} />
          <ScopedSettings
            locale={locale}
            workspaceId={workspaceId}
            scopeType="workspace"
            scopeId={workspaceId}
          />
          <Integrations locale={locale} workspaceId={workspaceId} />
        </div>
      )}
    </WorkspacePage>
  );
}
