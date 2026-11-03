'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { LiveAssistantPill } from './pill';
import { isLiveActive } from './state';
import { liveAssistant } from './store';
import { createFakeTransport, type FakeTransportOptions } from './transport';

/**
 * Mounted once in the root layout, next to the "AI is working" notice, so the live conversation
 * outlives every page change and does not depend on the Smart window (HUG-003, HUG-005). It owns
 * nothing while the assistant is off: no microphone, no network.
 */
export function LiveAssistantHost() {
  const active = useSyncExternalStore(
    liveAssistant.subscribe,
    () => isLiveActive(liveAssistant.getSnapshot().status),
    () => false,
  );

  // Reloading or closing the tab ends a live session for good, so the browser asks first.
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  // Development and tests only: lets a script switch on a stand-in provider. Not in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const hook = {
      store: liveAssistant,
      useFakeTransport: (options?: FakeTransportOptions) =>
        liveAssistant.setTransportFactory(() => createFakeTransport(options)),
    };
    (window as unknown as { __docooLive?: typeof hook }).__docooLive = hook;
    return () => {
      delete (window as unknown as { __docooLive?: typeof hook }).__docooLive;
    };
  }, []);

  return <LiveAssistantPill />;
}
