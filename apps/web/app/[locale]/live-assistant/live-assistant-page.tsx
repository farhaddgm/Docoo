'use client';

import type { Locale } from '../../i18n';
import { LiveAssistantSettings } from '../../live-assistant/live-assistant-settings';
import { liveSettingsMessages } from '../../live-assistant/settings-messages';
import { WorkspacePage } from '../workspace-page';

/** The voice assistant's own settings page (ADR-0055 §4-8); a super administrator only. */
export function LiveAssistantPage({ locale }: { locale: Locale }) {
  const text = liveSettingsMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <LiveAssistantSettings locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}
