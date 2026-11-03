'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { formatNumber } from '../i18n';
import { useLocale } from '../locale-context';
import { clampPosition, isDrag } from './drag';
import { liveMessagesFor } from './messages';
import { liveAssistant } from './store';

const CLOSE_VISIBLE_MS = 4000;

interface DragState {
  readonly pointer: number;
  readonly startX: number;
  readonly startY: number;
  readonly originX: number;
  readonly originY: number;
  moved: boolean;
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * The floating pill of the live conversation (HUG-004, HUG-005). It behaves like the "AI is
 * working" notice: small, draggable with mouse or touch, it stays while pages change, and a double
 * click (or keyboard focus) reveals a close button. Closing ends the session for good. It also
 * counts the tokens the conversation has used.
 */
export function LiveAssistantPill() {
  const locale = useLocale();
  const text = liveMessagesFor(locale);
  const state = useSyncExternalStore(
    liveAssistant.subscribe,
    liveAssistant.getSnapshot,
    liveAssistant.getServerSnapshot,
  );
  const [showClose, setShowClose] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  // A session that never started (it was refused) is explained in the Smart tab, not by a pill.
  const visible =
    state.status !== 'off' && (state.status !== 'error' || state.error === 'connection_lost');
  const failed = state.status === 'error';
  const closeShown = showClose || failed;

  useEffect(() => {
    if (!visible) setShowClose(false);
  }, [visible]);

  useEffect(() => {
    if (!showClose || failed) return;
    const timer = setTimeout(() => setShowClose(false), CLOSE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [showClose, failed]);

  // Keep a dragged or remembered position inside the window, also after the window is resized.
  const position = state.position;
  useEffect(() => {
    if (!visible || !position) return;
    const fit = () => {
      const box = element.current?.getBoundingClientRect();
      if (!box) return;
      const next = clampPosition(position, { width: box.width, height: box.height }, viewport());
      if (next.x !== position.x || next.y !== position.y) liveAssistant.move(next);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [visible, position]);

  if (!visible) return null;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: box.left,
      originY: box.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && !isDrag(dx, dy)) return;
    current.moved = true;
    const box = event.currentTarget.getBoundingClientRect();
    liveAssistant.move(
      clampPosition(
        { x: current.originX + dx, y: current.originY + dy },
        { width: box.width, height: box.height },
        viewport(),
      ),
    );
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setShowClose(true);
    } else if (event.key === 'Escape') setShowClose(false);
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    // Keyboard users have no double click: focusing the pill reveals the close button.
    if (event.target === event.currentTarget && event.target.matches(':focus-visible')) {
      setShowClose(true);
    }
  }

  const statusText =
    failed && state.error ? text.card.errors[state.error] : text.status[state.status];
  const style = position
    ? { left: position.x, top: position.y, bottom: 'auto', transform: 'none' }
    : undefined;

  return (
    <div
      ref={element}
      className="live-pill"
      data-state={state.status}
      style={style}
      role="group"
      aria-label={text.pill.aria}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => setShowClose(true)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <span className="live-pill-orb" aria-hidden="true" />
      <span className="live-pill-name">{text.name}</span>
      <span className="live-pill-status" role="status" aria-live="polite">
        {statusText}
      </span>
      <span className="live-pill-tokens" title={text.pill.tokensTitle}>
        {formatNumber(locale, state.tokens)} {text.pill.tokens}
      </span>
      {closeShown && (
        <button
          type="button"
          className="live-pill-close"
          aria-label={text.pill.close}
          title={text.pill.closeTitle}
          onClick={() => {
            setShowClose(false);
            void liveAssistant.stop();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
