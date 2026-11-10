'use client';

import { usePathname } from 'next/navigation';

import { AiActivityIndicator } from './ai-activity';
import { InfoTipHost } from './info-tip';
import { LiveAssistantHost } from './live-assistant/host';
import { isMonitorWindowPath } from './monitor/paths';

/**
 * The parts of the back office that float over every page: help tips, the "AI is working" notice
 * and the voice assistant. A monitor window (ADR-0056) is a bare page for a room screen, so none
 * of them belong there: no assistant button, no microphone, nothing of the back office.
 */
export function ChromeHosts() {
  const pathname = usePathname();
  if (isMonitorWindowPath(pathname)) return null;
  return (
    <>
      <InfoTipHost />
      <AiActivityIndicator />
      <LiveAssistantHost />
    </>
  );
}
