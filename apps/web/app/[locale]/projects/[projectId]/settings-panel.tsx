'use client';

import type { Locale } from '../../../i18n';
import { ProjectModelSection, ScopedSettings } from '../../settings/scoped-settings';
import { settingsMessages } from '../../settings/settings-messages';

/**
 * The project's own settings (UX §6, ADR-0018): what differs from the topics and the workspace,
 * and the project's model. Archived and deleted projects are read-only on the server too.
 */
export function ProjectSettingsPanel({
  locale,
  workspaceId,
  projectId,
  readOnly,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  readOnly: boolean;
}) {
  const text = settingsMessages(locale);
  return (
    <div className="stack">
      {readOnly && <p className="notice">{text.errors['CONFIG_SCOPE_READ_ONLY']}</p>}
      <ProjectModelSection locale={locale} workspaceId={workspaceId} projectId={projectId} />
      <ScopedSettings
        locale={locale}
        workspaceId={workspaceId}
        scopeType="project"
        scopeId={projectId}
      />
    </div>
  );
}
