'use client';

import type { Locale } from '../../i18n';
import { MonitorLauncher } from '../../monitor/monitor-launcher';
import { monitorMessages } from '../../monitor/messages';
import { WorkspacePage } from '../workspace-page';

/** The monitor page of the back office (ADR-0056); a super administrator only. */
export function MonitorPage({ locale }: { locale: Locale }) {
  const text = monitorMessages(locale).launcher;
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <MonitorLauncher locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}
