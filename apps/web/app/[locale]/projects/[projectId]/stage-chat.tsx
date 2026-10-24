'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { ApiError, apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatNumber, type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

interface Message {
  id: string;
  role: 'admin' | 'agent';
  kind: 'ask' | 'revision_request' | 'answer' | 'rejection_sent';
  content: string;
  status: 'done' | 'failed';
  outputId: string | null;
  replyTo: string | null;
}

interface Conversation {
  items: Message[];
  pendingRevisionIds: string[];
  used: number;
  limit: number;
  outputId: string | null;
}

/** Ready-made messages per stage; touching one puts it in the input, the admin still sends it. */
const presets: Record<string, Record<Locale, string[]>> = {
  analysis: {
    fa: ['بیشتر توضیح بده', 'به زبان ساده بگو', 'خلاصه مهم تحلیل رو بگو'],
    en: ['Explain more', 'Say it in plain words', 'Summarize the key points of the analysis'],
  },
  research: {
    fa: [
      'بیشتر توضیح بده',
      'به زبان ساده بگو',
      'خلاصه مهم تحقیق رو بگو',
      'به نظر چه تحقیق دیگه ای کمک کننده است',
    ],
    en: [
      'Explain more',
      'Say it in plain words',
      'Summarize the key points of the research',
      'What other research would help, in your view?',
    ],
  },
  ideation: {
    fa: [
      'بیشتر توضیح بده',
      'به زبان ساده بگو',
      'فرق های مهم بین ایده ها رو بگو',
      'خلاصه ایده ها رو بگو',
    ],
    en: [
      'Explain more',
      'Say it in plain words',
      'Tell me the important differences between the ideas',
      'Summarize the ideas',
    ],
  },
};

const copy = {
  fa: {
    presetsLabel: 'پیام‌های آماده',
    title: 'گفتگو با ایجنت این مرحله',
    askOnly: 'این مرحله اکنون منتظر بازبینی شما نیست؛ فقط می‌توانید دربارهٔ خروجی بپرسید.',
    help: 'می‌توانید دربارهٔ همین خروجی بپرسید. ایجنت فقط توضیح می‌دهد و خروجی را تغییر نمی‌دهد؛ برای اصلاح، «درخواست بازبینی» بفرستید و سپس آن را به‌عنوان رد، برای تلاش بعدی ارسال کنید.',
    placeholder: 'پیام شما به ایجنت…',
    ask: 'پرسش',
    revise: 'درخواست بازبینی',
    sending: 'ایجنت در حال پاسخ است…',
    you: 'شما',
    agent: 'ایجنت',
    revisionBadge: 'درخواست بازبینی',
    sentBadge: 'ارسال‌شده به‌عنوان رد',
    failed: 'ایجنت پاسخ نداد ({code}). دوباره بپرسید.',
    pending: '{n} درخواست بازبینی هنوز فرستاده نشده است.',
    send: 'ارسال درخواست‌های بازبینی به‌عنوان رد',
    sendNote: 'این کار خروجی را رد می‌کند و یک تلاش تازه می‌سازد که از سقف تلاش‌ها حساب می‌شود.',
    used: '{used} از {limit} پیام',
    empty: 'هنوز پیامی نیست.',
    noOutput: 'پس از اینکه این مرحله خروجی داد، می‌توانید با ایجنتش گفتگو کنید.',
    loadFailed: 'گفتگو بارگذاری نشد.',
    errors: {
      STAGE_CHAT_LIMIT: 'سقف پیام‌های این مرحله پر شده است.',
      AI_NOT_CONFIGURED: 'هوش مصنوعی هنوز تنظیم نشده است.',
      WORKFLOW_OUTPUT_SUPERSEDED: 'این نسخه از خروجی عوض شده است؛ صفحه را تازه کنید.',
      STAGE_CHAT_ALREADY_SENT: 'این درخواست قبلاً فرستاده شده است.',
    } as Record<string, string>,
    generic: 'انجام نشد. دوباره تلاش کنید.',
  },
  en: {
    presetsLabel: 'Ready-made messages',
    title: 'Talk to the agent of this stage',
    askOnly: 'This stage is not waiting for your review now; you can only ask about its output.',
    help: 'Ask about this output. The agent only explains and never changes it. To get it corrected, send a revision request, then send it back as a rejection for the next attempt.',
    placeholder: 'Your message to the agent…',
    ask: 'Ask',
    revise: 'Revision request',
    sending: 'The agent is answering…',
    you: 'You',
    agent: 'Agent',
    revisionBadge: 'Revision request',
    sentBadge: 'Sent back as a rejection',
    failed: 'The agent did not answer ({code}). Ask again.',
    pending: '{n} revision request(s) not sent back yet.',
    send: 'Send revision requests back as a rejection',
    sendNote:
      'This rejects the output and starts a new attempt, which counts against the attempt limit.',
    used: '{used} of {limit} messages',
    empty: 'No messages yet.',
    noOutput: 'Once this stage has an output you can talk to its agent here.',
    loadFailed: 'The conversation could not be loaded.',
    errors: {
      STAGE_CHAT_LIMIT: 'This stage reached its message limit.',
      AI_NOT_CONFIGURED: 'AI is not configured yet.',
      WORKFLOW_OUTPUT_SUPERSEDED: 'This output version was replaced; reload the page.',
      STAGE_CHAT_ALREADY_SENT: 'This request was already sent back.',
    } as Record<string, string>,
    generic: 'It did not work. Try again.',
  },
} as const;

/** How many messages of a long conversation show at once; older ones are scrolled to. */
const VISIBLE_MESSAGES = 4;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

/**
 * ADR-0031: the administrator's conversation with the agent of a stage, under its output. A
 * message never edits the output; revision requests move it only by being sent back as the
 * ordinary rejection.
 */
export function StageChat({
  locale,
  stageBase,
  onChanged,
  canRevise = true,
  stage,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}/stages/{stageRunId}` */
  stageBase: string;
  onChanged: () => Promise<void>;
  /** A revision request can be sent back only while the output waits at a gate. */
  canRevise?: boolean;
  /** Selects the ready-made messages shown under the input. */
  stage?: string;
}) {
  const text = copy[locale];
  const quick = (stage && presets[stage]?.[locale]) || [];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [data, setData] = useState<Conversation | null>(null);
  const [failed, setFailed] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const thread = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Conversation>(`${stageBase}/messages`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [stageBase]);

  useEffect(() => {
    void load();
  }, [load]);

  function explain(caught: unknown): string {
    return (caught instanceof ApiError && caught.code && text.errors[caught.code]) || text.generic;
  }

  async function post(kind: 'ask' | 'revision_request') {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiSend('POST', `${stageBase}/messages`, { kind, content });
      setInput('');
    } catch (caught) {
      setError(explain(caught));
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function sendBack() {
    if (!data || data.pendingRevisionIds.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiSend(
        'POST',
        `${stageBase}/messages/send-as-rejection`,
        { messageIds: data.pendingRevisionIds },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      await onChanged();
    } catch (caught) {
      setError(explain(caught));
    } finally {
      setBusy(false);
      await load();
    }
  }

  const sent = new Set(
    (data?.items ?? []).filter((m) => m.kind === 'rejection_sent').map((m) => m.replyTo),
  );
  const visible = (data?.items ?? []).filter((m) => m.kind !== 'rejection_sent');
  const full = data ? data.used >= data.limit : false;

  // The thread is as tall as its last four bubbles, whatever their length, and shows the newest.
  const count = visible.length;
  useLayoutEffect(() => {
    const list = thread.current;
    if (!list) return;
    const fit = () => {
      const bubbles = Array.from(list.children).slice(-VISIBLE_MESSAGES) as HTMLElement[];
      const style = getComputedStyle(list);
      const gap = Number.parseFloat(style.rowGap) || 0;
      const padding =
        Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd);
      const border =
        Number.parseFloat(style.borderBlockStartWidth) +
        Number.parseFloat(style.borderBlockEndWidth);
      const height = bubbles.reduce((sum, bubble) => sum + bubble.offsetHeight, 0);
      const wanted = height + gap * Math.max(bubbles.length - 1, 0) + padding + border;
      list.style.maxBlockSize = count > VISIBLE_MESSAGES ? `${Math.ceil(wanted)}px` : '';
      list.scrollTop = list.scrollHeight;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    return () => observer.disconnect();
  }, [count, locale, data]);

  return (
    <section className="stack" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{text.title}</h3>
      <p className="muted">{canRevise ? text.help : text.askOnly}</p>
      {failed && !data ? (
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      ) : (
        <>
          {visible.length === 0 ? (
            <p className="muted">{text.empty}</p>
          ) : (
            <ul
              ref={thread}
              className="chat-thread"
              aria-label={text.title}
              // The thread scrolls once there are more than four messages; it must be reachable
              // from the keyboard then.
              tabIndex={count > VISIBLE_MESSAGES ? 0 : undefined}
            >
              {visible.map((message) => (
                <li
                  key={message.id}
                  className={`chat-message ${message.role === 'admin' ? 'chat-message-mine' : 'chat-message-agent'}`}
                >
                  <p className="chat-meta">
                    <strong>{message.role === 'admin' ? text.you : text.agent}</strong>
                    {message.kind === 'revision_request' && (
                      <span className="badge">{text.revisionBadge}</span>
                    )}
                    {sent.has(message.id) && <span className="badge">{text.sentBadge}</span>}
                  </p>
                  {message.status === 'failed' ? (
                    <p className="notice error">{fill(text.failed, { code: message.content })}</p>
                  ) : (
                    <p className="chat-text" dir={textDir(locale)}>
                      {message.content}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data && data.pendingRevisionIds.length > 0 && !readOnly && (
            <div className="stack">
              <p role="status">
                {fill(text.pending, { n: formatNumber(locale, data.pendingRevisionIds.length) })}
              </p>
              <p className="muted">{text.sendNote}</p>
              <div className="toolbar">
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void sendBack()}
                >
                  {text.send}
                </button>
              </div>
            </div>
          )}
          {!readOnly && (
            <div className="field-stack">
              <label htmlFor={`${id}-input`} className="visually-hidden">
                {text.placeholder}
              </label>
              <textarea
                id={`${id}-input`}
                rows={3}
                dir={textDir(locale)}
                maxLength={4000}
                value={input}
                placeholder={text.placeholder}
                disabled={busy || full}
                onChange={(event) => setInput(event.target.value)}
              />
              <div className="toolbar">
                <button
                  data-write-action
                  className="primary-button"
                  type="button"
                  disabled={busy || full || !input.trim()}
                  onClick={() => void post('ask')}
                >
                  {text.ask}
                </button>
                {canRevise && (
                  <button
                    data-write-action
                    className="secondary-button"
                    type="button"
                    disabled={busy || full || !input.trim()}
                    onClick={() => void post('revision_request')}
                  >
                    {text.revise}
                  </button>
                )}
                {data && (
                  <small className="muted">
                    {fill(text.used, {
                      used: formatNumber(locale, data.used),
                      limit: formatNumber(locale, data.limit),
                    })}
                  </small>
                )}
              </div>
              {quick.length > 0 && (
                <div className="toolbar" role="group" aria-label={text.presetsLabel}>
                  {quick.map((message) => (
                    <button
                      key={message}
                      className="secondary-button"
                      type="button"
                      disabled={busy || full}
                      onClick={() => setInput(message)}
                    >
                      {message}
                    </button>
                  ))}
                </div>
              )}
              {busy && (
                <p className="muted" role="status">
                  {text.sending}
                </p>
              )}
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The conversation with the agent of one stage, shown in that stage's own tab (analysis, research,
 * ideas, documents, evaluation). It finds the stage run in the workflow and shows nothing until
 * the stage has an output to talk about.
 */
export function StageAgentChat({
  locale,
  base,
  stage,
  refreshKey = 0,
  onChanged,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  stage: string;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const text = copy[locale];
  const [item, setItem] = useState<StageRef | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const { workflow } = await apiGet<{ workflow: { stages: StageRef[] } }>(`${base}/workflow`);
      setItem(workflow.stages.find((entry) => entry.stage === stage) ?? null);
    } catch {
      setItem(null);
    }
  }, [base, stage]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!item?.id || !item.latestOutputId) {
    return (
      <section className="card stack">
        <h3>{text.title}</h3>
        <p className="muted">{text.noOutput}</p>
      </section>
    );
  }
  return (
    <div className="card">
      <StageChat
        locale={locale}
        stageBase={`${base}/stages/${item.id}`}
        stage={stage}
        canRevise={Boolean(item.pendingGateOutputId)}
        onChanged={async () => {
          await load();
          onChanged?.();
        }}
      />
    </div>
  );
}

interface StageRef {
  id: string | null;
  stage: string;
  latestOutputId?: string | null;
  pendingGateOutputId?: string | null;
}
