'use client';

import type { Locale } from '../../../i18n';
import { monitorMessages } from '../../../monitor/messages';
import { MonitorSettings } from '../../../monitor/monitor-settings';
import { WorkspacePage } from '../../workspace-page';

/** The settings page of the monitors (ADR-0056 §8); a super administrator only. */
export function MonitorSettingsPage({ locale }: { locale: Locale }) {
  const text = monitorMessages(locale).settings;
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <MonitorSettings locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}
