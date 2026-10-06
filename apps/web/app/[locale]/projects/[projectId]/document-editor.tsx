'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { apiSend } from '../../../api-client';
import { formatNumber, type Locale } from '../../../i18n';
import { explainError, Notice, useAction } from '../../use-action';
import { BlockList } from './block-editor';
import type { DocBlock, DocContent } from './document-content';
import {
  cleanForSave,
  dropDanglingCitations,
  findBibliography,
  outlineOf,
  sameContent,
} from './document-editor-model';
import { editorMessages, fill } from './editor-messages';
import { TermIssues, type TermIssueView } from './term-issues';

interface Check {
  valid: boolean;
  problems: string[];
  compliance?: {
    level: number;
    count: number;
    bounds: { min: number; max: number };
    withinBounds: boolean;
    deviation: number;
  };
  references?: { id: string; text: string; cited: boolean }[];
  termIssues?: TermIssueView[];
}

/**
 * The structured editor of a document (UX §10): the outline, one editor per block, a live check
 * of the structure and of the official count against the level, and a save as a new version.
 * The server validates and counts again on save; the live check only shows the result early.
 */
export function DocumentEditor({
  locale,
  workspaceId,
  documentId,
  documentVersion,
  level,
  initial,
  onClose,
}: {
  locale: Locale;
  workspaceId: string;
  documentId: string;
  documentVersion: number;
  level: number;
  initial: DocContent;
  onClose: (saved: boolean) => void;
}) {
  const text = editorMessages(locale);
  const base = `/workspaces/${workspaceId}/documents/${documentId}`;
  const [content, setContent] = useState<DocContent>(initial);
  const [reason, setReason] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(true);
  const sequence = useRef(0);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const dirty = !sameContent(content, initial);

  // Every change is checked on the server after a short pause: structure, official count, outline.
  useEffect(() => {
    const ticket = sequence.current + 1;
    sequence.current = ticket;
    setChecking(true);
    const handle = setTimeout(
      () => {
        apiSend<{ check: Check }>('POST', `${base}/check`, {
          content: cleanForSave(content),
          level,
        })
          .then((result) => {
            if (sequence.current === ticket) setCheck(result.check);
          })
          .catch(() => {
            if (sequence.current === ticket) setCheck(null);
          })
          .finally(() => {
            if (sequence.current === ticket) setChecking(false);
          });
      },
      ticket === 1 ? 0 : 600,
    );
    return () => clearTimeout(handle);
  }, [base, content, level]);

  // A browser close with unsaved edits asks first; leaving through the editor's own buttons asks too.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setBlocks = (blocks: DocBlock[]) =>
    setContent((current) => ({ ...current, blocks: dropDanglingCitations(blocks) }));

  const bibliography = findBibliography(content.blocks);
  const references = (bibliography?.entries ?? []).map((entry) => ({
    id: entry.id,
    text: entry.text,
  }));
  const outline = outlineOf(content.blocks);

  const jump = (id: string) => {
    const element = document.getElementById(`block-${id}`);
    element?.scrollIntoView({ block: 'center' });
    element?.focus();
  };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend(
        'PUT',
        `${base}/content`,
        { content: cleanForSave(content), reason: reason.trim(), level },
        { version: documentVersion },
      );
      onClose(true);
    }, '');
  }

  function leave() {
    if (dirty && !window.confirm(text.confirmDiscard)) return;
    onClose(false);
  }

  const compliance = check?.compliance;
  const reasonOk = reason.trim().length >= 3;

  return (
    <section className="card" aria-labelledby="editor-title">
      <h2 id="editor-title">{text.editorTitle}</h2>
      <p className="muted">{text.editorHelp}</p>
      <Notice notice={notice} />
      <div className="editor-layout">
        <div className="stack">
          <div className="editor-field">
            <label htmlFor="editor-doc-title">{text.docTitle}</label>
            <input
              id="editor-doc-title"
              className="inline-input"
              dir="auto"
              value={content.title}
              disabled={busy}
              onChange={(event) => setContent({ ...content, title: event.target.value })}
            />
          </div>
          <BlockList
            locale={locale}
            blocks={content.blocks}
            all={content.blocks}
            references={references}
            depth={0}
            disabled={busy}
            onChange={setBlocks}
          />
        </div>

        <aside className="editor-side" aria-label={text.check}>
          <section className="card" aria-labelledby="editor-check-title">
            <h3 id="editor-check-title">{text.check}</h3>
            <div role="status" aria-live="polite">
              {checking && <p className="muted">{text.checking}</p>}
              {!checking && check && check.valid && compliance && (
                <>
                  <p>
                    {text.characters}: <strong>{formatNumber(locale, compliance.count)}</strong>
                  </p>
                  <p>
                    {fill(text.bounds, {
                      level: formatNumber(locale, compliance.level),
                      min: formatNumber(locale, compliance.bounds.min),
                      max: formatNumber(locale, compliance.bounds.max),
                    })}
                  </p>
                  <p>
                    <span
                      className={`badge ${compliance.withinBounds ? 'state-passed' : 'state-failed'}`}
                    >
                      {compliance.withinBounds ? text.inBounds : text.outOfBounds}
                    </span>{' '}
                    {compliance.deviation < 0 &&
                      fill(text.short, { n: formatNumber(locale, -compliance.deviation) })}
                    {compliance.deviation > 0 &&
                      fill(text.long, { n: formatNumber(locale, compliance.deviation) })}
                  </p>
                  <p className="muted">{text.validStructure}</p>
                </>
              )}
            </div>
            {!checking && check && !check.valid && (
              <div role="alert">
                <p>
                  <strong>{text.problems}</strong>
                </p>
                <ul className="plain-list">
                  {check.problems.map((problem) => (
                    <li key={problem} dir="ltr">
                      {problem}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <TermIssues locale={locale} issues={check?.termIssues} />
            {check?.references && check.references.length > 0 && (
              <>
                <h4>{text.referencesUsed}</h4>
                <ul className="plain-list">
                  {check.references.map((reference) => (
                    <li key={reference.id}>
                      <span dir="auto">
                        {reference.id}: {reference.text}
                      </span>{' '}
                      <span className="muted">
                        ({reference.cited ? text.referenceCited : text.referenceUnused})
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <nav className="card" aria-labelledby="editor-outline-title">
            <h3 id="editor-outline-title">{text.outline}</h3>
            {outline.length === 0 ? (
              <p className="muted">{text.noHeadings}</p>
            ) : (
              <ul className="plain-list editor-outline">
                {outline.map((item) => (
                  <li key={item.id} className={`outline-level-${item.level}`}>
                    <button
                      type="button"
                      className="link-like"
                      onClick={() => jump(item.id)}
                      dir="auto"
                    >
                      {item.text || item.id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <form data-write-action className="card filter-form" onSubmit={save} aria-busy={busy}>
            <div className="field-stack">
              <label htmlFor="editor-reason">{text.reasonLabel}</label>
              <input
                id="editor-reason"
                value={reason}
                minLength={3}
                maxLength={1000}
                required
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {dirty && <p className="muted">{text.unsaved}</p>}
            <div className="toolbar">
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !dirty || !reasonOk || (check !== null && !check.valid)}
              >
                {busy ? text.saving : text.save}
              </button>
              <button className="secondary-button" type="button" disabled={busy} onClick={leave}>
                {dirty ? text.discard : text.close}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </section>
  );
}
