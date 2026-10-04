'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { formatNumber, type Locale } from '../i18n';
import type { SmartError } from './api';
import type { ChatSeed } from './chat-tab';
import { installErrorReporter, setReporterWorkspace } from './error-reporter';
import { fill, smartMessagesFor } from './messages';
import { SmartPanel } from './panel';
import { useSmartSummary } from './summary';
import { SmartToasts } from './toasts';
import { smartUi } from './ui-state';
import { projectIdFromPath } from './walker';

function useUi() {
  return useSyncExternalStore(smartUi.subscribe, smartUi.getSnapshot, smartUi.getServerSnapshot);
}

/** Header button: Smart on/off with the number of open errors (SMT-002). */
export function SmartToggle({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = smartMessagesFor(locale);
  const ui = useUi();
  const summary = useSmartSummary(workspaceId, ui.enabled);
  const open = ui.enabled && summary ? summary.openErrors : 0;
  return (
    <button
      type="button"
      className="secondary-button smart-toggle"
      aria-pressed={ui.enabled}
      title={ui.enabled ? text.toggleOn : text.toggleOff}
      onClick={() => smartUi.update({ enabled: !ui.enabled })}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="nav-icon"
      >
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
      </svg>
      {text.name}
      {open > 0 && (
        <span className="badge" title={fill(text.openCount, { n: open })}>
          {formatNumber(locale, open)}
        </span>
      )}
    </button>
  );
}

/**
 * Smart: error reporter, toasts and the floating window, mounted once per signed-in page.
 * Reporting to the server always runs; switching Smart off only hides what the admin sees.
 */
export function SmartRoot({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = smartMessagesFor(locale);
  const ui = useUi();
  const pathname = usePathname() || `/${locale}`;
  const summary = useSmartSummary(workspaceId, ui.enabled);
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [seed, setSeed] = useState<ChatSeed | null>(null);
  const [walkerStep, setWalkerStep] = useState<string | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    setReporterWorkspace(workspaceId);
    return installErrorReporter();
  }, [workspaceId]);

  // The walker follows the project page the admin is on.
  useEffect(() => {
    const projectId = projectIdFromPath(pathname);
    if (projectId) smartUi.update({ projectId });
  }, [pathname]);

  const onAsk = useCallback((prompt: string, stepKey: string) => {
    nonce.current += 1;
    setWalkerStep(stepKey);
    setSeed({ nonce: nonce.current, text: prompt });
    smartUi.update({ tab: 'chat' });
  }, []);

  const onChatAboutError = useCallback(
    (error: SmartError) => {
      nonce.current += 1;
      setSeed({ nonce: nonce.current, text: text.chat.errorPrompt, errorId: error.id });
      smartUi.update({ tab: 'chat', minimized: false });
    },
    [text.chat.errorPrompt],
  );

  const onDetails = useCallback((errorId: string) => {
    setSelectedErrorId(errorId);
    smartUi.update({ tab: 'errors', minimized: false });
  }, []);

  if (!ui.enabled) return null;

  const open = summary?.openErrors ?? 0;
  return (
    <>
      <SmartToasts locale={locale} workspaceId={workspaceId} onDetails={onDetails} />
      <SmartPanel
        locale={locale}
        workspaceId={workspaceId}
        ui={ui}
        route={pathname}
        walkerStep={walkerStep}
        selectedErrorId={selectedErrorId}
        seed={seed}
        onWalkerStep={setWalkerStep}
        onSelectError={setSelectedErrorId}
        onAsk={onAsk}
        onChatAboutError={onChatAboutError}
      />
      {ui.minimized && (
        <button
          type="button"
          className={`smart-fab smart-side-${ui.side}`}
          aria-label={text.panel.expand}
          title={text.panel.expand}
          onClick={() => smartUi.update({ minimized: false })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
          </svg>
          {open > 0 && <span className="smart-fab-badge">{formatNumber(locale, open)}</span>}
        </button>
      )}
    </>
  );
}
