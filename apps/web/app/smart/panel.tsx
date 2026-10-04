'use client';

import { useId, type KeyboardEvent } from 'react';

import type { Locale } from '../i18n';
import type { SmartError } from './api';
import { ChatTab, type ChatSeed } from './chat-tab';
import { ErrorsTab } from './errors-tab';
import { smartMessagesFor } from './messages';
import { smartUi, type SmartTab, type SmartUiState } from './ui-state';
import { WalkerTab } from './walker-tab';

interface SmartPanelProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly ui: SmartUiState;
  readonly route: string;
  readonly walkerStep: string | null;
  readonly selectedErrorId: string | null;
  readonly seed: ChatSeed | null;
  readonly onWalkerStep: (key: string | null) => void;
  readonly onSelectError: (id: string | null) => void;
  readonly onAsk: (prompt: string, stepKey: string) => void;
  readonly onChatAboutError: (error: SmartError) => void;
}

const TABS: readonly SmartTab[] = ['walker', 'chat', 'errors'];

/** The floating window: Walker, Chat and Errors tabs (SMT-002..004). */
export function SmartPanel(props: SmartPanelProps) {
  const { locale, workspaceId, ui } = props;
  const text = smartMessagesFor(locale);
  const idBase = useId();

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') smartUi.update({ minimized: true });
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!move) return;
    // Arrow keys follow the reading direction of the page.
    const direction = locale === 'fa' ? -move : move;
    const next = TABS[(index + direction + TABS.length) % TABS.length]!;
    smartUi.update({ tab: next });
    document.getElementById(`${idBase}-tab-${next}`)?.focus();
  }

  return (
    <aside
      className={`smart-panel smart-side-${ui.side}`}
      aria-label={text.panel.label}
      hidden={ui.minimized}
      onKeyDown={onKeyDown}
    >
      <header className="smart-panel-head">
        <strong>{text.name}</strong>
        <span className="smart-panel-actions">
          <button
            type="button"
            className="smart-icon-button"
            aria-label={text.panel.switchSide}
            title={text.panel.switchSide}
            onClick={() => smartUi.update({ side: ui.side === 'end' ? 'start' : 'end' })}
          >
            ⇄
          </button>
          <button
            type="button"
            className="smart-icon-button"
            aria-label={text.panel.minimize}
            title={text.panel.minimize}
            onClick={() => smartUi.update({ minimized: true })}
          >
            –
          </button>
        </span>
      </header>
      <div className="smart-tabs" role="tablist" aria-label={text.panel.label}>
        {TABS.map((tab, index) => (
          <button
            key={tab}
            id={`${idBase}-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={ui.tab === tab}
            aria-controls={`${idBase}-panel-${tab}`}
            tabIndex={ui.tab === tab ? 0 : -1}
            onClick={() => smartUi.update({ tab })}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {text.panel.tabs[tab]}
          </button>
        ))}
      </div>
      <div
        id={`${idBase}-panel-walker`}
        role="tabpanel"
        aria-labelledby={`${idBase}-tab-walker`}
        hidden={ui.tab !== 'walker'}
        className="smart-body"
      >
        <WalkerTab
          locale={locale}
          workspaceId={workspaceId}
          active={!ui.minimized && ui.tab === 'walker'}
          projectId={ui.projectId}
          onProject={(projectId) => smartUi.update({ projectId })}
          onAsk={props.onAsk}
          onStep={props.onWalkerStep}
        />
      </div>
      <div
        id={`${idBase}-panel-chat`}
        role="tabpanel"
        aria-labelledby={`${idBase}-tab-chat`}
        hidden={ui.tab !== 'chat'}
        className="smart-body smart-body-chat"
      >
        <ChatTab
          locale={locale}
          workspaceId={workspaceId}
          active={!ui.minimized && ui.tab === 'chat'}
          seed={props.seed}
          route={props.route}
          projectId={ui.projectId}
          walkerStep={props.walkerStep}
        />
      </div>
      <div
        id={`${idBase}-panel-errors`}
        role="tabpanel"
        aria-labelledby={`${idBase}-tab-errors`}
        hidden={ui.tab !== 'errors'}
        className="smart-body"
      >
        <ErrorsTab
          locale={locale}
          workspaceId={workspaceId}
          active={!ui.minimized && ui.tab === 'errors'}
          selectedId={props.selectedErrorId}
          onSelect={props.onSelectError}
          onChat={props.onChatAboutError}
        />
      </div>
    </aside>
  );
}
