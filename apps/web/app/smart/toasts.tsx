'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n';
import { smartBus } from './bus';
import { smartApi } from './api';
import { fill, smartMessagesFor } from './messages';
import { createToastGate, isLocalEcho, type LocalServerEvent } from './toast-logic';
import { normalizeDisplayPath } from './format';

const FEED_MS = 10_000;
const TOAST_MS = 12_000;
const MAX_TOASTS = 4;

interface Toast {
  readonly id: number;
  readonly message: string;
  readonly errorId: string | null;
}

interface SmartToastsProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly onDetails: (errorId: string) => void;
}

/**
 * Error toasts. Errors this browser causes show at once (bus); errors of the worker or other
 * sessions arrive through the feed poll. Both are shown only while Smart is on.
 */
export function SmartToasts({ locale, workspaceId, onDetails }: SmartToastsProps) {
  const text = smartMessagesFor(locale);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const local = useRef<LocalServerEvent[]>([]);
  const toastedIds = useRef(new Set<string>());
  const gate = useRef(createToastGate(30_000));
  const messages = useRef(text);
  messages.current = text;

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, errorId: string | null) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, message, errorId }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const off = smartBus.on((event) => {
      if (event.type === 'server-error') {
        local.current = [
          ...local.current.slice(-19),
          { method: event.method.toUpperCase(), status: event.status, at: Date.now() },
        ];
        const path = normalizeDisplayPath(event.path);
        if (gate.current(`server|${event.method}|${path}|${event.status}`, Date.now())) {
          push(fill(messages.current.toast.server, { status: event.status, path }), null);
        }
      } else if (event.type === 'error-recorded') {
        toastedIds.current.add(event.errorId);
        if (gate.current(`client|${event.message}`, Date.now())) {
          push(
            fill(messages.current.toast.client, { message: event.message.slice(0, 120) }),
            event.errorId,
          );
        }
      }
    });
    return off;
  }, [push]);

  useEffect(() => {
    let since = new Date().toISOString();
    const controller = new AbortController();
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const feed = await smartApi.feed(workspaceId, since, controller.signal);
        since = feed.now;
        for (const item of feed.items) {
          if (toastedIds.current.has(item.id) || isLocalEcho(item, local.current)) continue;
          push(
            fill(messages.current.toast.recorded, { message: item.message.slice(0, 120) }),
            item.id,
          );
        }
      } catch {
        /* the next tick tries again; an outage must not spam toasts */
      }
    };
    const timer = setInterval(() => void poll(), FEED_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [workspaceId, push]);

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearTimeout(timer);
      active.clear();
    };
  }, []);

  return (
    <div className="smart-toasts" role="region" aria-label={text.toast.region} aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="smart-toast">
          <p>{toast.message}</p>
          <div className="toolbar">
            {toast.errorId && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  onDetails(toast.errorId!);
                  dismiss(toast.id);
                }}
              >
                {text.toast.details}
              </button>
            )}
            <button type="button" className="secondary-button" onClick={() => dismiss(toast.id)}>
              {text.toast.dismiss}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
