'use client';

import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface PageTab<K extends string> {
  readonly key: K;
  readonly label: string;
}

/**
 * The tab chosen on a page, kept in the address (`?tab=history`) so a reload or a link returns to
 * it. The first tab is the default.
 */
export function useTabParam<K extends string>(keys: readonly K[]): [K, (next: K) => void] {
  const [tab, setTab] = useState<K>(keys[0] as K);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    const found = keys.find((key) => key === requested);
    if (found) setTab(found);
    // The list of tabs is fixed for a page; it is read once.
  }, []);
  const choose = useCallback((next: K) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return [tab, choose];
}

/** A row of tabs at the top of a long page, so its parts are chosen instead of scrolled to. */
export function PageTabs<K extends string>({
  label,
  idPrefix,
  tabs,
  active,
  onChange,
}: {
  label: string;
  idPrefix: string;
  tabs: readonly PageTab<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const index = tabs.findIndex((tab) => tab.key === active);
    let next = -1;
    if (event.key === forward) next = (index + 1) % tabs.length;
    else if (event.key === backward) next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const key = tabs[next]?.key;
    if (!key) return;
    onChange(key);
    document.getElementById(`${idPrefix}-tab-${key}`)?.focus();
  }

  return (
    <div className="tabs page-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.key}`}
          aria-selected={active === tab.key}
          aria-controls={`${idPrefix}-panel-${tab.key}`}
          tabIndex={active === tab.key ? 0 : -1}
          className="tab"
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The content of one tab. Every panel stays mounted and the others are only hidden, so what was
 * typed or loaded in a tab is still there when it is chosen again.
 */
export function PageTabPanel({
  idPrefix,
  tabKey,
  active,
  children,
}: {
  idPrefix: string;
  tabKey: string;
  active: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      hidden={active !== tabKey}
      id={`${idPrefix}-panel-${tabKey}`}
      aria-labelledby={`${idPrefix}-tab-${tabKey}`}
      className="stack"
    >
      {children}
    </div>
  );
}
