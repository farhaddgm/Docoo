'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatDateTime, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import {
  Badge,
  joinList,
  ScopeEditor,
  ScopeSelect,
  safeHref,
  scopeText,
  scopesPayload,
  sourceTone,
  statusTone,
  useScopeOptions,
  type ScopeOptions,
  type ScopeRow,
} from './knowledge-common';
import { knowledgeMessages, type KnowledgeText } from './knowledge-messages';
import {
  confidentialities,
  sourceInFlight,
  sourceStatuses,
  type Confidentiality,
  type KnowledgeStatus,
  type ScopeChoice,
  type SourceRow,
} from './knowledge-types';
import { ACCEPTED_EXTENSIONS, uploadSourceFile } from './source-upload';

type Mode = 'file' | 'text' | 'url';

/** How often the list refreshes while a source is still being scanned or read. */
const POLL_MS = 3000;

function warningText(text: KnowledgeText, warning: string): string {
  const known = text.warnings[warning];
  if (known) return known;
  const failed = /^ocr_failed_page_(\d+)$/u.exec(warning);
  if (failed) return fill(text.warningOcrFailed, { page: failed[1]! });
  const low = /^ocr_low_confidence_page_(\d+)$/u.exec(warning);
  if (low) return fill(text.warningOcrLow, { page: low[1]! });
  return warning;
}

/** Sources of the workspace, or of one project or topic when the panel is embedded. */
export function SourcesPanel({
  locale,
  workspaceId,
  scopeType,
  scopeId,
  readOnly = false,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  scopeType?: 'project' | 'topic';
  scopeId?: string;
  /** An archived or deleted project's sources can be read but not changed. */
  readOnly?: boolean;
  /** Something that other lists may show (new knowledge) changed. */
  onChanged?: () => void;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const scoped = scopeType !== undefined && scopeId !== undefined;
  const options = useScopeOptions(workspaceId);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);

  const [items, setItems] = useState<SourceRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [versioning, setVersioning] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const request = useRef(0);
  const known = useRef(new Map<string, string>());

  useEffect(() => {
    const timer = setTimeout(() => setApplied(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const path = useCallback(
    (cursor?: string) =>
      `${base}/sources${query({
        limit: '50',
        cursor,
        status,
        q: applied,
        ...(scopeType && scopeId ? { scopeType, scopeId } : {}),
      })}`,
    [base, status, applied, scopeType, scopeId],
  );

  /** Tells assistive technology when a source finishes processing, once. */
  const remember = useCallback(
    (rows: readonly SourceRow[]) => {
      for (const row of rows) {
        const current = row.currentVersion?.status;
        if (!current) continue;
        const before = known.current.get(row.id);
        known.current.set(row.id, current);
        if (before && before !== current && !sourceInFlight.includes(current)) {
          setAnnounce(`${row.title}: ${text.sourceStatuses[current]}`);
        }
      }
    },
    [text],
  );

  const reload = useCallback(async () => {
    const mine = ++request.current;
    try {
      const page = await apiGet<{ items: SourceRow[]; nextCursor: string | null }>(path());
      if (mine !== request.current) return;
      remember(page.items);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setFailed(false);
    } catch {
      if (mine === request.current) setFailed(true);
    }
  }, [path, remember]);

  useEffect(() => {
    setItems(null);
    void reload();
  }, [reload]);

  // While a source is still in the pipeline the first page refreshes by itself.
  const processing = items?.some(
    (row) => row.currentVersion && sourceInFlight.includes(row.currentVersion.status),
  );
  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await apiGet<{ items: SourceRow[]; nextCursor: string | null }>(path());
          remember(page.items);
          setItems((current) => {
            if (!current) return page.items;
            const fresh = new Map(page.items.map((row) => [row.id, row]));
            const merged = current.map((row) => fresh.get(row.id) ?? row);
            const added = page.items.filter((row) => !current.some((old) => old.id === row.id));
            return [...added, ...merged];
          });
        } catch {
          // The next tick tries again; a failed refresh must not replace the list with an error.
        }
      })();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [processing, items, path, remember]);

  async function loadMore() {
    if (!nextCursor || more) return;
    setMore(true);
    try {
      const page = await apiGet<{ items: SourceRow[]; nextCursor: string | null }>(
        path(nextCursor),
      );
      remember(page.items);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setNotice({ ok: false, text: text.failed });
    } finally {
      setMore(false);
    }
  }

  async function retry(row: SourceRow) {
    if (!row.currentVersionId) return;
    await run(async () => {
      await apiSend('POST', `${base}/sources/${row.id}/versions/${row.currentVersionId}/retry`);
      await reload();
    }, text.retried);
  }

  const filtered = status !== '' || applied !== '';

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.sourcesHeading}</h2>
      <p className="muted">{text.sourcesHelp}</p>
      <Notice notice={notice} />
      {created && (
        <p className="notice ok" role="status">
          {text.created}{' '}
          <Link href={`/${locale}/knowledge/${created.id}` as Route}>{text.openCreated}</Link>
        </p>
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>

      {readOnly ? null : !adding ? (
        <p>
          <button type="button" className="primary-button" onClick={() => setAdding(true)}>
            {text.addSource}
          </button>
        </p>
      ) : (
        <AddSource
          locale={locale}
          workspaceId={workspaceId}
          fixedScope={scoped ? { type: scopeType, id: scopeId } : null}
          options={options}
          onCancel={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            setNotice({ ok: true, text: text.sourceAdded });
            await reload();
          }}
          onFailed={reload}
        />
      )}

      <form className="filter-grid" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor={`${id}-search`}>{text.sourceSearch}</label>
        <input
          id={`${id}-search`}
          type="search"
          dir="auto"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label htmlFor={`${id}-status`}>{text.sourceStatusFilter}</label>
        <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{text.allSourceStatuses}</option>
          {sourceStatuses.map((item) => (
            <option key={item} value={item}>
              {text.sourceStatuses[item]}
            </option>
          ))}
        </select>
      </form>

      {processing && (
        <p className="muted" role="status">
          {text.processing}{' '}
          <button type="button" className="link-like" onClick={() => void reload()}>
            {text.refresh}
          </button>
        </p>
      )}
      {failed && (
        <p className="notice error" role="alert">
          {text.failed}
        </p>
      )}
      {!failed && items === null && <p role="status">{text.loading}</p>}
      {items?.length === 0 && (
        <p className="muted" role="status">
          {filtered ? text.sourcesEmptyFiltered : text.sourcesEmpty}
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="source-list" aria-label={text.sourceCaption}>
          {items.map((row) => {
            const version = row.currentVersion;
            const current = version?.status;
            const warnings = version?.extraction?.warnings ?? [];
            const canBuild = !readOnly && (current === 'indexed' || current === 'partial');
            const canRetry = !readOnly && (current === 'quarantined' || current === 'failed');
            const canVersion = !readOnly && row.kind === 'file' && current !== undefined;
            return (
              <li key={row.id} className="card stack">
                <h3 dir="auto">{row.title}</h3>
                <p>
                  {current && (
                    <Badge tone={sourceTone(current)}>{text.sourceStatuses[current]}</Badge>
                  )}{' '}
                  <span className="muted" dir="auto">
                    {text.kinds[row.kind]} · {scopeText(text, { ...row.scope })} ·{' '}
                    {formatDateTime(locale, row.updatedAt)}
                  </span>
                </p>
                {version?.filename && row.kind === 'file' && (
                  <p className="muted" dir="auto">
                    {version.filename}
                  </p>
                )}
                {version?.originUrl && (
                  <p className="muted" dir="ltr">
                    {safeHref(version.originUrl) ? (
                      <a href={safeHref(version.originUrl)!} rel="noopener noreferrer">
                        {version.originUrl}
                      </a>
                    ) : (
                      version.originUrl
                    )}
                  </p>
                )}
                {(current === 'rejected' || current === 'failed' || version?.failureCode) &&
                  version?.failureCode && (
                    <p className="notice error" role="status">
                      {text.failureCodes[version.failureCode] ??
                        fill(text.failureUnknown, { code: version.failureCode })}
                    </p>
                  )}
                {current === 'partial' && (
                  <p className="highlight" role="status">
                    {fill(text.partialNote, {
                      warnings:
                        joinList(
                          locale,
                          warnings.map((w) => warningText(text, w)),
                        ) || '—',
                    })}
                  </p>
                )}

                <div>
                  <strong>{text.sourceColumns.knowledge}</strong>
                  {row.knowledge.length === 0 ? (
                    <p className="muted">{text.noDerived}</p>
                  ) : (
                    <ul className="plain-list">
                      {row.knowledge.map((item) => (
                        <li key={item.id} dir="auto">
                          <Link href={`/${locale}/knowledge/${item.id}` as Route}>
                            {item.title}
                          </Link>{' '}
                          <Badge tone={statusTone(item.status as KnowledgeStatus)}>
                            {text.statuses[item.status as KnowledgeStatus] ?? item.status}
                          </Badge>
                          {item.stale && <Badge tone="danger">{text.staleBadge}</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="toolbar">
                  {canBuild && (
                    <button
                      type="button"
                      className="secondary-button"
                      aria-expanded={creating === row.id}
                      aria-label={fill(text.makeKnowledgeLabel, { title: row.title })}
                      onClick={() => setCreating(creating === row.id ? null : row.id)}
                    >
                      {text.makeKnowledge}
                    </button>
                  )}
                  {canRetry && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      aria-label={fill(text.retryLabel, { title: row.title })}
                      onClick={() => void retry(row)}
                    >
                      {text.retry}
                    </button>
                  )}
                  {canVersion && (
                    <button
                      type="button"
                      className="secondary-button"
                      aria-expanded={versioning === row.id}
                      aria-label={fill(text.newSourceVersionLabel, { title: row.title })}
                      onClick={() => setVersioning(versioning === row.id ? null : row.id)}
                    >
                      {text.newSourceVersion}
                    </button>
                  )}
                </p>

                {creating === row.id && (
                  <CreateKnowledgeForm
                    locale={locale}
                    workspaceId={workspaceId}
                    source={row}
                    options={options}
                    onCancel={() => setCreating(null)}
                    onDone={async (knowledgeId) => {
                      setCreating(null);
                      setCreated({ id: knowledgeId });
                      await reload();
                      onChanged?.();
                    }}
                  />
                )}
                {versioning === row.id && (
                  <NewSourceVersionForm
                    locale={locale}
                    workspaceId={workspaceId}
                    source={row}
                    onCancel={() => setVersioning(null)}
                    onDone={async () => {
                      setVersioning(null);
                      setNotice({ ok: true, text: text.newSourceVersionDone });
                      await reload();
                      onChanged?.();
                    }}
                    onFailed={reload}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <p>
          <button type="button" className="secondary-button" disabled={more} onClick={loadMore}>
            {more ? text.loadingMore : text.loadMore}
          </button>
        </p>
      )}
    </section>
  );
}

/** Adds a file, pasted text or a web address as a new source (ING-001, ING-006). */
function AddSource({
  locale,
  workspaceId,
  fixedScope,
  options,
  onCancel,
  onAdded,
  onFailed,
}: {
  locale: Locale;
  workspaceId: string;
  fixedScope: ScopeChoice | null;
  options: ScopeOptions | null;
  onCancel: () => void;
  onAdded: () => Promise<void>;
  /** The source may exist even though the request failed (the file is safe in quarantine). */
  onFailed: () => Promise<void>;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const [mode, setMode] = useState<Mode>('file');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ScopeChoice>(
    fixedScope ?? { type: 'workspace', id: workspaceId },
  );
  const [file, setFile] = useState<File | null>(null);
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState<'fa' | 'en'>(locale);
  const [uploading, setUploading] = useState(false);

  const finalTitle = title.trim() || (mode === 'file' ? (file?.name ?? '') : '');
  const ready =
    finalTitle.length > 0 &&
    (mode === 'file'
      ? file !== null
      : mode === 'text'
        ? body.trim().length > 0
        : url.trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    const done = await run(async () => {
      try {
        if (mode === 'file') {
          setUploading(true);
          await uploadSourceFile(
            base,
            file!,
            { kind: 'new', title: finalTitle, scope },
            'KNOWLEDGE_UPLOAD_FAILED',
          );
        } else if (mode === 'text') {
          await apiSend('POST', `${base}/sources/text`, {
            title: finalTitle,
            scope,
            text: body,
            language,
          });
        } else {
          await apiSend('POST', `${base}/sources/url`, {
            title: finalTitle,
            scope,
            url: url.trim(),
            language,
          });
        }
      } catch (error) {
        await onFailed();
        throw error;
      } finally {
        setUploading(false);
      }
    }, '');
    if (done) await onAdded();
  }

  return (
    <form className="card field-stack" onSubmit={submit} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>{text.addSource}</h3>
      <Notice notice={notice} />
      <fieldset className="mode-choice">
        <legend>{text.addMode}</legend>
        {(['file', 'text', 'url'] as const).map((item) => (
          <label key={item} className="mode">
            <input
              type="radio"
              name={`${id}-mode`}
              value={item}
              checked={mode === item}
              onChange={() => setMode(item)}
            />{' '}
            {text.modes[item]}
          </label>
        ))}
      </fieldset>

      <label htmlFor={`${id}-title`}>{text.sourceTitle}</label>
      <input
        id={`${id}-title`}
        dir="auto"
        value={title}
        maxLength={300}
        placeholder={mode === 'file' ? file?.name : undefined}
        onChange={(event) => setTitle(event.target.value)}
      />

      {!fixedScope && (
        <>
          <ScopeSelect
            id={`${id}-scope`}
            label={text.sourceScope}
            value={scope}
            onChange={setScope}
            workspaceId={workspaceId}
            options={options}
            text={text}
          />
          <small className="muted">{text.sourceScopeHelp}</small>
        </>
      )}

      {mode === 'file' && (
        <div className="file-pick">
          <label htmlFor={`${id}-file`}>{text.file}</label>
          <input
            id={`${id}-file`}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            aria-describedby={`${id}-file-help`}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <small id={`${id}-file-help`} className="muted">
            {text.fileHelp}
          </small>
        </div>
      )}
      {mode === 'text' && (
        <>
          <label htmlFor={`${id}-text`}>{text.textLabel}</label>
          <textarea
            id={`${id}-text`}
            dir="auto"
            rows={8}
            value={body}
            maxLength={5_000_000}
            aria-describedby={`${id}-text-help`}
            onChange={(event) => setBody(event.target.value)}
          />
          <small id={`${id}-text-help`} className="muted">
            {text.textHelp}
          </small>
        </>
      )}
      {mode === 'url' && (
        <>
          <label htmlFor={`${id}-url`}>{text.urlLabel}</label>
          <input
            id={`${id}-url`}
            type="url"
            dir="ltr"
            value={url}
            maxLength={2048}
            aria-describedby={`${id}-url-help`}
            onChange={(event) => setUrl(event.target.value)}
          />
          <small id={`${id}-url-help`} className="muted">
            {text.urlHelp}
          </small>
        </>
      )}
      {mode !== 'file' && (
        <>
          <label htmlFor={`${id}-language`}>{text.languageLabel}</label>
          <select
            id={`${id}-language`}
            value={language}
            onChange={(event) => setLanguage(event.target.value as 'fa' | 'en')}
          >
            <option value="fa">{text.languages.fa}</option>
            <option value="en">{text.languages.en}</option>
          </select>
        </>
      )}

      {uploading && (
        <p className="muted" role="status">
          {text.uploading}
        </p>
      )}
      <p className="toolbar">
        <button type="submit" className="primary-button" disabled={busy || !ready}>
          {text.submitSource}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </p>
    </form>
  );
}

/** Builds a knowledge draft from an extracted source (ING-008). */
function CreateKnowledgeForm({
  locale,
  workspaceId,
  source,
  options,
  onCancel,
  onDone,
}: {
  locale: Locale;
  workspaceId: string;
  source: SourceRow;
  options: ScopeOptions | null;
  onCancel: () => void;
  onDone: (knowledgeId: string) => Promise<void>;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const partial = source.currentVersion?.status === 'partial';
  const [title, setTitle] = useState(source.title);
  const [confidentiality, setConfidentiality] = useState<Confidentiality>('internal');
  const [rows, setRows] = useState<ScopeRow[]>([
    { type: source.scope.type, id: source.scope.id, role: '' },
  ]);
  const [declaration, setDeclaration] = useState('');
  const [acceptPartial, setAcceptPartial] = useState(false);
  const ready =
    title.trim().length > 0 &&
    declaration.trim().length >= 3 &&
    rows.length > 0 &&
    (!partial || acceptPartial);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || !source.currentVersionId) return;
    let knowledgeId = '';
    const done = await run(async () => {
      const result = await apiSend<{ knowledge: { id: string } }>(
        'POST',
        `${base}/knowledge/from-source`,
        {
          sourceId: source.id,
          versionId: source.currentVersionId,
          title: title.trim(),
          confidentiality,
          scopes: scopesPayload(rows),
          declaration: declaration.trim(),
          acceptPartial,
        },
      );
      knowledgeId = result.knowledge.id;
    }, '');
    if (done) await onDone(knowledgeId);
  }

  return (
    <form className="card field-stack" onSubmit={submit} aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`}>{text.createHeading}</h4>
      <p className="muted">{text.createHelp}</p>
      <Notice notice={notice} />
      <label htmlFor={`${id}-title`}>{text.knowledgeTitle}</label>
      <input
        id={`${id}-title`}
        dir="auto"
        value={title}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
      />
      <label htmlFor={`${id}-conf`}>{text.confidentialityLabel}</label>
      <select
        id={`${id}-conf`}
        value={confidentiality}
        onChange={(event) => setConfidentiality(event.target.value as Confidentiality)}
      >
        {confidentialities.map((item) => (
          <option key={item} value={item}>
            {text.confidentiality[item]}
          </option>
        ))}
      </select>
      <ScopeEditor
        rows={rows}
        onChange={setRows}
        workspaceId={workspaceId}
        options={options}
        text={text}
        disabled={busy}
      />
      <label htmlFor={`${id}-declaration`}>{text.declarationLabel}</label>
      <textarea
        id={`${id}-declaration`}
        dir="auto"
        rows={3}
        value={declaration}
        maxLength={2000}
        aria-describedby={`${id}-declaration-help`}
        onChange={(event) => setDeclaration(event.target.value)}
      />
      <small id={`${id}-declaration-help`} className="muted">
        {text.declarationHelp}
      </small>
      {partial && (
        <label className="mode">
          <input
            type="checkbox"
            checked={acceptPartial}
            onChange={(event) => setAcceptPartial(event.target.checked)}
          />{' '}
          {text.partialAccept}
        </label>
      )}
      <p className="toolbar">
        <button type="submit" className="primary-button" disabled={busy || !ready}>
          {text.createSubmit}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </p>
    </form>
  );
}

/** Uploads a new version of a file source; knowledge built from the old one turns stale. */
function NewSourceVersionForm({
  locale,
  workspaceId,
  source,
  onCancel,
  onDone,
  onFailed,
}: {
  locale: Locale;
  workspaceId: string;
  source: SourceRow;
  onCancel: () => void;
  onDone: () => Promise<void>;
  onFailed: () => Promise<void>;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [uploading, setUploading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    const done = await run(async () => {
      try {
        setUploading(true);
        await uploadSourceFile(
          base,
          file,
          {
            kind: 'version',
            sourceId: source.id,
            sourceVersion: source.version,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          },
          'KNOWLEDGE_UPLOAD_FAILED',
        );
      } catch (error) {
        await onFailed();
        throw error;
      } finally {
        setUploading(false);
      }
    }, '');
    if (done) await onDone();
  }

  return (
    <form className="card field-stack" onSubmit={submit} aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`}>{text.newSourceVersion}</h4>
      <p className="muted">{text.newSourceVersionHelp}</p>
      <Notice notice={notice} />
      <label htmlFor={`${id}-file`}>{text.file}</label>
      <input
        id={`${id}-file`}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <label htmlFor={`${id}-reason`}>{text.newSourceVersionReason}</label>
      <input
        id={`${id}-reason`}
        dir="auto"
        value={reason}
        maxLength={1000}
        onChange={(event) => setReason(event.target.value)}
      />
      {uploading && (
        <p className="muted" role="status">
          {text.uploading}
        </p>
      )}
      <p className="toolbar">
        <button type="submit" className="primary-button" disabled={busy || !file}>
          {text.newSourceVersionSubmit}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </p>
    </form>
  );
}
