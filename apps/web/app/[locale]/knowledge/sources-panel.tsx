'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../i18n';
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
import { knowledgeHelp } from './knowledge-help';
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
import { FieldLabel, GroupLabel, InfoTip, SectionTitle } from '../../info-tip';

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
  const help = knowledgeHelp(locale);
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
  const [deleting, setDeleting] = useState<string | null>(null);
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

  async function remove(row: SourceRow, withKnowledge: boolean, reason: string) {
    await run(async () => {
      await apiSend('DELETE', `${base}/sources/${row.id}`, {
        withKnowledge,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setDeleting(null);
      await reload();
      onChanged?.();
    }, text.sourceDeleted);
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
      <SectionTitle id={`${id}-heading`} help={text.sourcesHelp}>
        {text.sourcesHeading}
      </SectionTitle>
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
        <FieldLabel htmlFor={`${id}-search`} help={help.sources.search}>
          {text.sourceSearch}
        </FieldLabel>
        <input
          id={`${id}-search`}
          type="search"
          dir={textDir(locale)}
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <FieldLabel htmlFor={`${id}-status`} help={help.sources.status}>
          {text.sourceStatusFilter}
        </FieldLabel>
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
                <h3 dir={textDir(locale)}>{row.title}</h3>
                <p>
                  {current && (
                    <Badge tone={sourceTone(current)}>{text.sourceStatuses[current]}</Badge>
                  )}{' '}
                  <span className="muted" dir={textDir(locale)}>
                    {text.kinds[row.kind]} · {scopeText(text, { ...row.scope })} ·{' '}
                    {formatDateTime(locale, row.updatedAt)}
                  </span>
                </p>
                {version?.filename && row.kind === 'file' && (
                  <p className="muted" dir={textDir(locale)}>
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
                  <InfoTip text={help.sources.derived} />
                  {row.knowledge.length === 0 ? (
                    <p className="muted">{text.noDerived}</p>
                  ) : (
                    <ul className="plain-list">
                      {row.knowledge.map((item) => (
                        <li key={item.id} dir={textDir(locale)}>
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
                  {!readOnly && (
                    <button
                      type="button"
                      className="secondary-button danger"
                      aria-expanded={deleting === row.id}
                      aria-label={fill(text.deleteSourceLabel, { title: row.title })}
                      onClick={() => setDeleting(deleting === row.id ? null : row.id)}
                    >
                      {text.deleteSource}
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

                {deleting === row.id && (
                  <DeleteSourceForm
                    locale={locale}
                    source={row}
                    busy={busy}
                    onCancel={() => setDeleting(null)}
                    onDelete={(withKnowledge, reason) => void remove(row, withKnowledge, reason)}
                  />
                )}

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
  const help = knowledgeHelp(locale);
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
        <legend>
          <GroupLabel help={help.add.mode}>{text.addMode}</GroupLabel>
        </legend>
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

      <FieldLabel htmlFor={`${id}-title`} help={help.add.title}>
        {text.sourceTitle}
      </FieldLabel>
      <input
        id={`${id}-title`}
        dir={textDir(locale)}
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
            help={text.sourceScopeHelp}
            value={scope}
            onChange={setScope}
            workspaceId={workspaceId}
            options={options}
            text={text}
          />
        </>
      )}

      {mode === 'file' && (
        <div className="file-pick">
          <FieldLabel htmlFor={`${id}-file`} help={text.fileHelp} helpId={`${id}-file-help`}>
            {text.file}
          </FieldLabel>
          <input
            id={`${id}-file`}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            aria-describedby={`${id}-file-help`}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
      )}
      {mode === 'text' && (
        <>
          <FieldLabel htmlFor={`${id}-text`} help={text.textHelp} helpId={`${id}-text-help`}>
            {text.textLabel}
          </FieldLabel>
          <textarea
            id={`${id}-text`}
            dir={textDir(locale)}
            rows={8}
            value={body}
            maxLength={5_000_000}
            aria-describedby={`${id}-text-help`}
            onChange={(event) => setBody(event.target.value)}
          />
        </>
      )}
      {mode === 'url' && (
        <>
          <FieldLabel htmlFor={`${id}-url`} help={text.urlHelp} helpId={`${id}-url-help`}>
            {text.urlLabel}
          </FieldLabel>
          <input
            id={`${id}-url`}
            type="url"
            dir="ltr"
            value={url}
            maxLength={2048}
            aria-describedby={`${id}-url-help`}
            onChange={(event) => setUrl(event.target.value)}
          />
        </>
      )}
      {mode !== 'file' && (
        <>
          <FieldLabel htmlFor={`${id}-language`} help={help.add.language}>
            {text.languageLabel}
          </FieldLabel>
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

const CREATE_STEPS = ['basics', 'scope', 'provenance', 'review'] as const;
type CreateStep = (typeof CREATE_STEPS)[number];

/**
 * Builds a knowledge draft from an extracted source (ING-008), one short step at a time: the
 * basics, where it applies, where it came from, and a last look before the draft is made.
 */
export function CreateKnowledgeForm({
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
  const help = knowledgeHelp(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const partial = source.currentVersion?.status === 'partial';
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [title, setTitle] = useState(source.title);
  const [confidentiality, setConfidentiality] = useState<Confidentiality>('internal');
  const [rows, setRows] = useState<ScopeRow[]>([
    { type: source.scope.type, id: source.scope.id, role: '' },
  ]);
  const [declaration, setDeclaration] = useState('');
  const [acceptPartial, setAcceptPartial] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // What each step still lacks; an empty string means the step is complete.
  const missing: Record<CreateStep, string> = {
    basics: title.trim().length > 0 ? '' : text.createNeeds.basics,
    scope: rows.length > 0 ? '' : text.createNeeds.scope,
    provenance:
      declaration.trim().length < 3
        ? text.createNeeds.provenance
        : partial && !acceptPartial
          ? text.createNeeds.partial
          : '',
    review: '',
  };
  const complete = (index: number) => missing[CREATE_STEPS[index]!] === '';
  const allReady = CREATE_STEPS.every((_, index) => complete(index));
  const last = step === CREATE_STEPS.length - 1;
  const current = CREATE_STEPS[step]!;

  // Moving between steps puts the reader at the top of the new step.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  function goTo(index: number) {
    setStep(index);
    setReached((value) => Math.max(value, index));
  }

  function scopeName(row: ScopeRow): string {
    const title =
      row.type === 'topic'
        ? options?.topics.find((topic) => topic.id === row.id)?.title
        : row.type === 'project'
          ? options?.projects.find((project) => project.id === row.id)?.title
          : null;
    return scopeText(text, { type: row.type, title: title ?? null, role: row.role || null });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    // Enter in a field moves on; only the last step makes the draft.
    if (!last) {
      if (complete(step)) goTo(step + 1);
      return;
    }
    if (!allReady || !source.currentVersionId) return;
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
      <SectionTitle as="h4" id={`${id}-heading`} help={text.createHelp}>
        {text.createHeading}
      </SectionTitle>
      <p className="muted">{text.createFlow}</p>
      <nav aria-label={text.createStepsLabel}>
        <ol className="stepper">
          {CREATE_STEPS.map((name, index) => {
            const done = index < step && complete(index);
            return (
              <li
                key={name}
                className={done ? 'step-done' : undefined}
                aria-current={index === step ? 'step' : undefined}
              >
                <button
                  type="button"
                  className="step-button"
                  disabled={busy || index > reached || index === step}
                  onClick={() => goTo(index)}
                >
                  <span className="step-number" aria-hidden="true">
                    {done ? '✓' : formatNumber(locale, index + 1)}
                  </span>
                  <span className="step-name">
                    <span className="visually-hidden">{formatNumber(locale, index + 1)}. </span>
                    {text.createSteps[name]}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <Notice notice={notice} />

      <div className="heading-with-tip">
        <h5 ref={heading} tabIndex={-1}>
          {fill(text.createStepOf, {
            n: formatNumber(locale, step + 1),
            total: formatNumber(locale, CREATE_STEPS.length),
            name: text.createSteps[current],
          })}
        </h5>
        <InfoTip text={help.create.steps[current]} />
      </div>

      {current === 'basics' && (
        <>
          <FieldLabel htmlFor={`${id}-title`} help={help.create.title}>
            {text.knowledgeTitle}
          </FieldLabel>
          <input
            id={`${id}-title`}
            dir={textDir(locale)}
            value={title}
            maxLength={300}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldLabel htmlFor={`${id}-conf`} help={help.create.confidentiality}>
            {text.confidentialityLabel}
          </FieldLabel>
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
        </>
      )}

      {current === 'scope' && (
        <ScopeEditor
          rows={rows}
          onChange={setRows}
          workspaceId={workspaceId}
          options={options}
          text={text}
          help={{ role: help.create.role, add: help.create.addScope }}
          disabled={busy}
        />
      )}

      {current === 'provenance' && (
        <>
          <FieldLabel
            htmlFor={`${id}-declaration`}
            help={text.declarationHelp}
            helpId={`${id}-declaration-help`}
          >
            {text.declarationLabel}
          </FieldLabel>
          <textarea
            id={`${id}-declaration`}
            dir={textDir(locale)}
            rows={3}
            value={declaration}
            maxLength={2000}
            aria-describedby={`${id}-declaration-help`}
            onChange={(event) => setDeclaration(event.target.value)}
          />
          {partial && (
            <label className="mode">
              <input
                type="checkbox"
                checked={acceptPartial}
                onChange={(event) => setAcceptPartial(event.target.checked)}
              />{' '}
              {text.partialAccept}
              <InfoTip text={help.create.acceptPartial} />
            </label>
          )}
        </>
      )}

      {current === 'review' && (
        <div className="stack">
          <p>{text.createReviewIntro}</p>
          <dl className="facts">
            <div>
              <dt>{text.createSummary.source}</dt>
              <dd dir={textDir(locale)}>{source.title}</dd>
            </div>
            <div>
              <dt>{text.knowledgeTitle}</dt>
              <dd dir={textDir(locale)}>{title.trim()}</dd>
            </div>
            <div>
              <dt>{text.confidentialityLabel}</dt>
              <dd>{text.confidentiality[confidentiality]}</dd>
            </div>
            <div>
              <dt>{text.scopeHeading}</dt>
              <dd>
                <ul className="plain-list">
                  {rows.map((row, index) => (
                    <li key={`${row.type}:${row.id}:${row.role}:${index}`} dir={textDir(locale)}>
                      {scopeName(row)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>{text.declarationLabel}</dt>
              <dd dir={textDir(locale)}>{declaration.trim()}</dd>
            </div>
            {partial && (
              <div>
                <dt>{text.createSummary.partial}</dt>
                <dd>{acceptPartial ? text.yes : text.none}</dd>
              </div>
            )}
          </dl>
          <div>
            <strong>{text.createNextHeading}</strong>
            <ol className="output-list">
              {text.createNextSteps.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {!last && missing[current] !== '' && (
        <p className="muted" role="status">
          {missing[current]}
        </p>
      )}
      <p className="toolbar">
        {step > 0 && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => goTo(step - 1)}
          >
            {text.createBack}
          </button>
        )}
        {last ? (
          <button type="submit" className="primary-button" disabled={busy || !allReady}>
            {text.createSubmit}
          </button>
        ) : (
          <button type="submit" className="primary-button" disabled={busy || !complete(step)}>
            {text.createNext}
          </button>
        )}
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
      <SectionTitle as="h4" id={`${id}-heading`} help={text.newSourceVersionHelp}>
        {text.newSourceVersion}
      </SectionTitle>
      <Notice notice={notice} />
      <FieldLabel htmlFor={`${id}-file`} help={text.fileHelp}>
        {text.file}
      </FieldLabel>
      <input
        id={`${id}-file`}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <FieldLabel htmlFor={`${id}-reason`} help={text.reasonHelp}>
        {text.newSourceVersionReason}
      </FieldLabel>
      <input
        id={`${id}-reason`}
        dir={textDir(locale)}
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

/** Confirms the deletion of a source; knowledge built from it goes only if the owner ticks it. */
function DeleteSourceForm({
  locale,
  source,
  busy,
  onCancel,
  onDelete,
}: {
  locale: Locale;
  source: SourceRow;
  busy: boolean;
  onCancel: () => void;
  onDelete: (withKnowledge: boolean, reason: string) => void;
}) {
  const text = knowledgeMessages(locale);
  const help = knowledgeHelp(locale);
  const id = useId();
  const [withKnowledge, setWithKnowledge] = useState(false);
  const [reason, setReason] = useState('');
  const count = source.knowledge.length;
  const blocked = count > 0 && !withKnowledge;
  return (
    <form
      className="card stack"
      aria-labelledby={`${id}-heading`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onDelete(withKnowledge, reason);
      }}
    >
      <h4 id={`${id}-heading`} dir={textDir(locale)}>
        {fill(text.deleteSourceHeading, { title: source.title })}
      </h4>
      <p className="muted">{text.deleteSourceHelp}</p>
      {count > 0 && (
        <label className="mode">
          <input
            type="checkbox"
            checked={withKnowledge}
            onChange={(event) => setWithKnowledge(event.target.checked)}
          />
          <span>{fill(text.deleteSourceWithKnowledge, { count: String(count) })}</span>
        </label>
      )}
      {blocked && (
        <p className="notice" role="status">
          {text.deleteSourceBlocked}
        </p>
      )}
      <label>
        <span className="field-label">
          {text.deleteReason}
          <InfoTip text={help.detail.deleteReason} />
        </span>
        <input
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <p className="toolbar">
        <button type="submit" className="secondary-button danger" disabled={busy || blocked}>
          {text.deleteSourceConfirm}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </p>
    </form>
  );
}
