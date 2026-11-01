'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';

import {
  getAiTasks,
  getServerAiTasks,
  setWorkflowStage,
  subscribeAiTasks,
  watchedWorkflows,
} from './ai-activity-store';
import { apiGet } from './api-client';
import type { Locale } from './i18n';
import { useLocale } from './locale-context';

const labels: Record<Locale, Record<string, string>> = {
  fa: {
    'stage:analysis': 'در حال تحلیل',
    'stage:research': 'در حال تحقیق',
    'stage:ideation': 'در حال ایده‌پردازی',
    'stage:documentation': 'در حال مستندسازی',
    'stage:evaluation': 'در حال ارزیابی',
    'task:questionQuality': 'در حال بررسی پرسش‌ها',
    'task:researchPlan': 'در حال تهیهٔ برنامهٔ تحقیق',
    'task:deliverables': 'در حال پیشنهاد خروجی‌ها',
    'task:workflow': 'در حال آغاز کار',
    'task:evaluate': 'در حال ارزیابی',
    'task:writing': 'در حال نوشتن سند',
    'task:sensitivity': 'در حال تحلیل حساسیت',
    'task:chat': 'در حال پاسخ‌گویی',
    fallback: 'هوش مصنوعی در حال کار است',
    status: 'هوش مصنوعی در حال کار است: {label}',
    close: 'بستن',
    more: '+{count}',
  },
  en: {
    'stage:analysis': 'Analyzing',
    'stage:research': 'Researching',
    'stage:ideation': 'Generating ideas',
    'stage:documentation': 'Writing documents',
    'stage:evaluation': 'Evaluating',
    'task:questionQuality': 'Checking questions',
    'task:researchPlan': 'Planning research',
    'task:deliverables': 'Proposing deliverables',
    'task:workflow': 'Getting started',
    'task:evaluate': 'Evaluating',
    'task:writing': 'Writing a document',
    'task:sensitivity': 'Analyzing sensitivity',
    'task:chat': 'Replying',
    fallback: 'The AI is working',
    status: 'The AI is working: {label}',
    close: 'Close',
    more: '+{count}',
  },
};

const POLL_MS = 5000;
const EXIT_MS = 320;
const CLOSE_VISIBLE_MS = 4000;
const DRAG_THRESHOLD = 4;
const RUNNING = new Set(['starting', 'running']);

interface WorkflowOverview {
  run: { status: string; currentStage: string | null } | null;
  stages: { stage: string; status: string }[];
}

/**
 * Small floating pill that tells the administrator an AI step is running. It sits at the bottom
 * centre, can be dragged anywhere (mouse or touch), stays while pages change, fades out when the work
 * ends, and a double click reveals a close button. Clicking it does nothing else.
 */
export function AiActivityIndicator() {
  const locale = useLocale();
  const text = labels[locale];
  const tasks = useSyncExternalStore(subscribeAiTasks, getAiTasks, getServerAiTasks);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [shown, setShown] = useState<{ label: string; extra: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointer: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  // Watched workflow runs are polled here, so the notice survives leaving the project page.
  const active = tasks.length > 0;
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      for (const base of watchedWorkflows()) {
        apiGet<{ workflow: WorkflowOverview }>(`${base}/workflow`)
          .then(({ workflow }) => {
            const running = workflow.run && RUNNING.has(workflow.run.status);
            const stage =
              workflow.stages.find((item) => item.status === 'running')?.stage ??
              workflow.run?.currentStage ??
              null;
            setWorkflowStage(base, running ? (stage ?? 'unknown') : null);
          })
          .catch(() => undefined);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const visibleTasks = tasks.filter((task) => !dismissed.has(task.id));
  const first = visibleTasks[0];
  const label = first ? (text[first.key] ?? text['fallback']!) : null;
  const extra = Math.max(0, visibleTasks.length - 1);

  // Keep the last label on screen while the pill fades out.
  useEffect(() => {
    if (label !== null) {
      setShown({ label, extra });
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    setShowClose(false);
    const timer = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [label, extra, shown]);

  // A dismissed task that finished no longer needs remembering.
  useEffect(() => {
    if (!active && dismissed.size > 0) setDismissed(new Set());
  }, [active, dismissed]);

  useEffect(() => {
    if (!showClose) return;
    const timer = setTimeout(() => setShowClose(false), CLOSE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [showClose]);

  // Keep a dragged pill inside the window after it is resized.
  useEffect(() => {
    const onResize = () =>
      setOffset((value) => {
        const box = element.current?.getBoundingClientRect();
        if (!value || !box) return value;
        return clamp(value.x, value.y, box.width, box.height);
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!shown) return null;

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
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    state.moved = true;
    const box = event.currentTarget.getBoundingClientRect();
    setOffset(clamp(state.originX + dx, state.originY + dy, box.width, box.height));
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  }

  const style = offset
    ? { left: offset.x, top: offset.y, bottom: 'auto', insetInlineStart: 'auto', transform: 'none' }
    : undefined;

  return (
    <div
      ref={element}
      className="ai-activity"
      data-leaving={leaving || undefined}
      style={style}
      role="status"
      aria-live="polite"
      aria-label={text['status']!.replace('{label}', shown.label)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => setShowClose(true)}
    >
      <span className="ai-activity-orb" aria-hidden="true" />
      <span className="ai-activity-label">{shown.label}</span>
      {shown.extra > 0 && (
        <span className="ai-activity-count">
          {text['more']!.replace('{count}', String(shown.extra))}
        </span>
      )}
      {showClose && (
        <button
          type="button"
          className="ai-activity-close"
          aria-label={text['close']}
          title={text['close']}
          onClick={() => {
            setDismissed(new Set(tasks.map((task) => task.id)));
            setShowClose(false);
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

function clamp(x: number, y: number, width: number, height: number) {
  const margin = 8;
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
    y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - margin)),
  };
}
