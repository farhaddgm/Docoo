'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { ApiError, apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatNumber, type Locale } from '../../../i18n';
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

const copy = {
  fa: {
    title: 'گفتگو با ایجنت این مرحله',
    askOnly: 'این مرحله اکنون منتظر بازبینی شما نیست؛ فقط می‌توانید دربارهٔ خروجی بپرسید.',
    open: 'گفتگو با ایجنت این مرحله',
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
    title: 'Talk to the agent of this stage',
    askOnly: 'This stage is not waiting for your review now; you can only ask about its output.',
    open: 'Talk to the agent of this stage',
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
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}/stages/{stageRunId}` */
  stageBase: string;
  onChanged: () => Promise<void>;
  /** A revision request can be sent back only while the output waits at a gate. */
  canRevise?: boolean;
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [data, setData] = useState<Conversation | null>(null);
  const [failed, setFailed] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
            <ul className="plain-list" aria-label={text.title}>
              {visible.map((message) => (
                <li key={message.id}>
                  <strong>{message.role === 'admin' ? text.you : text.agent}</strong>
                  {message.kind === 'revision_request' && (
                    <span className="badge"> {text.revisionBadge}</span>
                  )}
                  {sent.has(message.id) && <span className="badge"> {text.sentBadge}</span>}
                  <br />
                  {message.status === 'failed' ? (
                    <span className="notice error">
                      {fill(text.failed, { code: message.content })}
                    </span>
                  ) : (
                    <span dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                      {message.content}
                    </span>
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
                dir="auto"
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
 * The same conversation for a stage that is not waiting at a gate (running, finished): collapsed
 * until opened, so the page does not read every stage's messages at once.
 */
export function StageChatDisclosure({
  locale,
  stageBase,
  onChanged,
}: {
  locale: Locale;
  stageBase: string;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{copy[locale].open}</summary>
      {open && (
        <StageChat locale={locale} stageBase={stageBase} onChanged={onChanged} canRevise={false} />
      )}
    </details>
  );
}
