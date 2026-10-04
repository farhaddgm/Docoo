'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api-client';
import type { Locale } from '../i18n';
import { smartApi, type Conversation, type Message } from './api';
import { fill, smartErrorMessage, smartMessagesFor } from './messages';
import { refreshSummary } from './summary';

export interface ChatSeed {
  /** Changes on every request so the same text can be seeded twice. */
  readonly nonce: number;
  readonly text: string;
  readonly errorId?: string | undefined;
}

interface ChatTabProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly active: boolean;
  readonly seed: ChatSeed | null;
  readonly route: string;
  readonly projectId: string | null;
  readonly walkerStep: string | null;
}

/**
 * Per-admin chat. Smart answers once from a read-only snapshot built by the server; an answer
 * can be saved verbatim in the issue ledger.
 */
export function ChatTab({
  locale,
  workspaceId,
  active,
  seed,
  route,
  projectId,
  walkerStep,
}: ChatTabProps) {
  const text = smartMessagesFor(locale);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastSeed = useRef<number | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setConversations((await smartApi.conversations(workspaceId)).items);
    } catch {
      /* the list is a convenience */
    }
  }, [workspaceId]);

  useEffect(() => {
    if (active) void refreshList();
  }, [active, refreshList]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, busy]);

  const open = useCallback(
    async (id: string) => {
      setNotice('');
      setConfirmRemove(false);
      try {
        const body = await smartApi.conversation(workspaceId, id);
        setCurrentId(id);
        setMessages(body.messages);
      } catch {
        setNotice(text.chat.loadFailed);
      }
    },
    [workspaceId, text.chat.loadFailed],
  );

  const fresh = useCallback(() => {
    setCurrentId(null);
    setMessages([]);
    setNotice('');
    setConfirmRemove(false);
  }, []);

  // A seed from the walker ("ask about this step") or from an error ("chat with AI").
  useEffect(() => {
    if (!seed || lastSeed.current === seed.nonce) return;
    lastSeed.current = seed.nonce;
    setInput(seed.text);
    setNotice('');
    if (!seed.errorId) return;
    const errorId = seed.errorId;
    fresh();
    void smartApi
      .createConversation(workspaceId, {
        kind: 'error',
        route,
        errorId,
        ...(projectId ? { projectId } : {}),
      })
      .then((conversation) => {
        setCurrentId(conversation.id);
        void refreshList();
      })
      .catch((caught: unknown) =>
        setNotice(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined)),
      );
  }, [seed, fresh, workspaceId, route, projectId, locale, refreshList]);

  async function send(content: string, mode: 'chat' | 'report') {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setNotice('');
    const pending: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: trimmed,
      status: 'done',
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, pending]);
    if (mode === 'chat') setInput('');
    try {
      let id = currentId;
      if (!id) {
        const conversation = await smartApi.createConversation(workspaceId, {
          kind: 'walker',
          route,
          ...(projectId ? { projectId } : {}),
        });
        id = conversation.id;
        setCurrentId(id);
      }
      const answer = await smartApi.sendMessage(workspaceId, id, {
        content: trimmed,
        mode,
        route,
        locale,
        ...(projectId ? { projectId } : {}),
        ...(walkerStep ? { walkerStep } : {}),
      });
      setMessages((current) => [
        ...current.filter((item) => item.id !== pending.id),
        answer.userMessage,
        answer.assistantMessage,
      ]);
      void refreshList();
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== pending.id));
      if (mode === 'chat') setInput(trimmed);
      setNotice(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
    } finally {
      setBusy(false);
    }
  }

  async function save(message: Message) {
    setSaving(message.id);
    setNotice('');
    try {
      const { issue } = await smartApi.saveIssue(workspaceId, message.id);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, savedIssueId: issue.id } : item,
        ),
      );
      refreshSummary();
    } catch (caught) {
      setNotice(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (!currentId) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    try {
      await smartApi.deleteConversation(workspaceId, currentId);
      fresh();
      void refreshList();
    } catch (caught) {
      setNotice(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
    }
  }

  return (
    <div className="smart-chat">
      <div className="toolbar">
        <button type="button" className="secondary-button" onClick={fresh}>
          {text.chat.new}
        </button>
        <select
          aria-label={text.chat.history}
          value={currentId ?? ''}
          onChange={(event) => (event.target.value ? void open(event.target.value) : fresh())}
        >
          <option value="">{text.chat.history}</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.kind === 'error'
                ? `⚠ ${conversation.title || text.chat.errorContext}`
                : conversation.title || text.chat.untitled}
            </option>
          ))}
        </select>
        {currentId && (
          <button type="button" className="secondary-button" onClick={() => void remove()}>
            {confirmRemove ? text.chat.removeConfirm : text.chat.remove}
          </button>
        )}
      </div>

      <div className="smart-messages" role="log" aria-live="polite">
        {messages.length === 0 && !busy && <p className="muted">{text.chat.empty}</p>}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`smart-message-box smart-from-${message.role}${message.status === 'failed' ? ' smart-failed' : ''}`}
          >
            <p className="smart-who">
              {message.role === 'user' ? text.chat.you : text.chat.assistant}
            </p>
            {message.status === 'failed' ? (
              <p className="notice error">{fill(text.chat.failed, { code: message.content })}</p>
            ) : (
              <p className="smart-text">{message.content}</p>
            )}
            {message.role === 'assistant' && message.status === 'done' && (
              <div className="toolbar">
                {message.savedIssueId ? (
                  <>
                    <span className="badge">{text.chat.saved}</span>
                    <Link
                      className="link-like"
                      href={`/${locale}/smart/issues?issue=${message.savedIssueId}` as Route}
                    >
                      {text.chat.openLedger}
                    </Link>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving === message.id}
                    onClick={() => void save(message)}
                  >
                    {saving === message.id ? text.chat.saving : text.chat.save}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {busy && (
          <p className="muted" role="status">
            {text.chat.thinking}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {notice && <p className="notice error">{notice}</p>}

      <div className="smart-compose">
        <textarea
          value={input}
          rows={3}
          maxLength={4000}
          placeholder={text.chat.placeholder}
          aria-label={text.chat.placeholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send(input, 'chat');
            }
          }}
        />
        <div className="toolbar">
          <button
            type="button"
            className="primary-button"
            disabled={busy || !input.trim()}
            onClick={() => void send(input, 'chat')}
          >
            {text.chat.send}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || messages.length === 0}
            onClick={() => void send(text.chat.reportPrompt, 'report')}
          >
            {text.chat.report}
          </button>
        </div>
      </div>
    </div>
  );
}
