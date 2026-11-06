'use client';

import type { Locale } from '../../i18n';
import { VoiceSettings } from '../../voice/voice-settings';
import { Integrations } from '../integrations/integrations-page';
import { Templates } from '../templates/templates-page';
import { PageTabPanel, PageTabs, useTabParam } from '../../page-tabs';
import { WorkspacePage } from '../workspace-page';
import { ScopedSettings } from './scoped-settings';
import { settingsMessages } from './settings-messages';

const SETTINGS_TABS = ['templates', 'general', 'voice', 'integrations'] as const;

/** System settings (UX §2, ADR-0018): the workspace defaults every project starts from. */
export function SettingsPage({ locale }: { locale: Locale }) {
  const text = settingsMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <SettingsTabs locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

function SettingsTabs({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = settingsMessages(locale);
  const [tab, setTab] = useTabParam(SETTINGS_TABS);
  return (
    <div className="stack">
      <PageTabs
        label={text.tabsLabel}
        idPrefix="settings"
        tabs={SETTINGS_TABS.map((key) => ({ key, label: text.tabs[key] }))}
        active={tab}
        onChange={setTab}
      />
      <PageTabPanel idPrefix="settings" tabKey="templates" active={tab}>
        <Templates locale={locale} workspaceId={workspaceId} showSettingsLink={false} />
      </PageTabPanel>
      <PageTabPanel idPrefix="settings" tabKey="general" active={tab}>
        <ScopedSettings
          locale={locale}
          workspaceId={workspaceId}
          scopeType="workspace"
          scopeId={workspaceId}
          tabbed
        />
      </PageTabPanel>
      <PageTabPanel idPrefix="settings" tabKey="voice" active={tab}>
        <VoiceSettings locale={locale} workspaceId={workspaceId} />
      </PageTabPanel>
      <PageTabPanel idPrefix="settings" tabKey="integrations" active={tab}>
        <Integrations locale={locale} workspaceId={workspaceId} />
      </PageTabPanel>
    </div>
  );
}
