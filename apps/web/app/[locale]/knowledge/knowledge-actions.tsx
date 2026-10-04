'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, useAction } from '../use-action';
import { isoToLocal, localToIso } from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import type { BrainDecision, KnowledgeDetail, SourceStatus } from './knowledge-types';

/** Statuses the API lets an audit start from (KNO-003). */
const auditable = new Set(['draft', 'pending', 'in_review', 'needs_revision', 'rejected']);

interface SourceInfo {
  title: string;
  currentVersionId: string | null;
  versions: { id: string; versionNo: number; status: SourceStatus }[];
}

/** The state of the one action running on the page, shared by every section that starts one. */
export type KnowledgeAction = ReturnType<typeof useAction>;

export function useKnowledgeAction(locale: Locale): KnowledgeAction {
  const text = knowledgeMessages(locale);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  return useAction(explain);
}

interface SectionProps {
  locale: Locale;
  workspaceId: string;
  knowledge: KnowledgeDetail;
  onChanged: () => Promise<void>;
  action: KnowledgeAction;
}

/** Sending the item to the Brain, and renewing it when its source file changed. */
export function AuditSection({ locale, workspaceId, knowledge, onChanged, action }: SectionProps) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}/knowledge/${knowledge.id}`;
  const version = knowledge.currentVersion;
  const { busy, setNotice, run } = action;
  const stale = Boolean(version?.staleReason);
  const canAudit = version !== null && !stale && auditable.has(version.status);

  async function audit() {
    if (!version) return;
    await run(async () => {
      const result = await apiSend<{ review: { decision: BrainDecision; overall: number } }>(
        'POST',
        `${base}/submit-audit`,
      );
      await onChanged();
      setNotice({
        ok: true,
        text: fill(text.auditDone, {
          decision: text.brainDecisions[result.review.decision],
          score: formatNumber(locale, result.review.overall),
        }),
      });
    }, '');
  }

  if (!version) return null;
  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.actionsHeading}</h2>
      {version && !stale && (
        <div className="stack">
          {canAudit ? (
            <>
              <p className="muted">{text.submitAuditHelp}</p>
              <p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void audit()}
                >
                  {version.status === 'draft' || version.status === 'pending'
                    ? text.submitAudit
                    : text.reaudit}
                </button>
              </p>
            </>
          ) : (
            <p className="muted">{text.alreadyReviewed}</p>
          )}
        </div>
      )}

      {stale && (
        <RenewFromSource
          locale={locale}
          workspaceId={workspaceId}
          base={base}
          knowledge={knowledge}
          busy={busy}
          run={run}
          onChanged={onChanged}
          setNotice={setNotice}
        />
      )}
    </section>
  );
}

/** Writing a new version of the text, and deleting the item. */
export function EditSection({ locale, workspaceId, knowledge, onChanged, action }: SectionProps) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const router = useRouter();
  const base = `/workspaces/${workspaceId}/knowledge/${knowledge.id}`;
  const version = knowledge.currentVersion;
  const { busy, setNotice, run } = action;

  const [content, setContent] = useState(version?.content ?? '');
  const [reason, setReason] = useState('');
  const [validFrom, setValidFrom] = useState(isoToLocal(version?.validFrom ?? null));
  const [validUntil, setValidUntil] = useState(isoToLocal(version?.validUntil ?? null));
  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const deleteHeading = useRef<HTMLHeadingElement>(null);

  // A different version (new text saved, renewed from the source) resets the text form.
  const versionId = version?.id;
  useEffect(() => {
    setContent(version?.content ?? '');
    setReason('');
    setValidFrom(isoToLocal(version?.validFrom ?? null));
    setValidUntil(isoToLocal(version?.validUntil ?? null));
    // The form follows the version, not each of its fields.
  }, [versionId]);

  useEffect(() => {
    if (deleting) deleteHeading.current?.focus();
  }, [deleting]);

  const changed = content !== (version?.content ?? '');
  const validityChanged =
    validFrom !== isoToLocal(version?.validFrom ?? null) ||
    validUntil !== isoToLocal(version?.validUntil ?? null);

  async function saveVersion(event: FormEvent) {
    event.preventDefault();
    if (busy || !reason.trim() || !(changed || validityChanged)) return;
    await run(async () => {
      const from = localToIso(validFrom);
      const until = localToIso(validUntil);
      const result = await apiSend<{ knowledge: KnowledgeDetail }>(
        'POST',
        `${base}/versions`,
        {
          content,
          reason: reason.trim(),
          ...(from ? { validFrom: from } : {}),
          ...(until ? { validUntil: until } : {}),
        },
        { version: knowledge.version },
      );
      await onChanged();
      setNotice({
        ok: true,
        text: fill(text.newVersionDone, {
          n: formatNumber(locale, result.knowledge.currentVersion?.versionNo ?? 0),
        }),
      });
    }, '');
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const done = await run(async () => {
      await apiSend('DELETE', base, deleteReason.trim() ? { reason: deleteReason.trim() } : {});
    }, '');
    if (done) router.push(`/${locale}/knowledge?deleted=1` as Route);
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.editHeading}</h2>
      {version && (
        <form className="field-stack" onSubmit={saveVersion}>
          <h3>{text.newVersionHeading}</h3>
          <p className="muted">{text.newVersionHelp}</p>
          <label htmlFor={`${id}-content`}>{text.contentLabel}</label>
          <textarea
            id={`${id}-content`}
            dir="auto"
            rows={10}
            value={content}
            maxLength={2_000_000}
            onChange={(event) => setContent(event.target.value)}
          />
          <label htmlFor={`${id}-from`}>{text.validFromLabel}</label>
          <input
            id={`${id}-from`}
            type="datetime-local"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
          />
          <label htmlFor={`${id}-until`}>{text.validUntilLabel}</label>
          <input
            id={`${id}-until`}
            type="datetime-local"
            value={validUntil}
            aria-describedby={`${id}-until-help`}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          <small id={`${id}-until-help`} className="muted">
            {text.validityHelp}
          </small>
          <label htmlFor={`${id}-reason`}>{text.reasonLabel}</label>
          <input
            id={`${id}-reason`}
            dir="auto"
            value={reason}
            maxLength={1000}
            aria-describedby={`${id}-reason-help`}
            onChange={(event) => setReason(event.target.value)}
          />
          <small id={`${id}-reason-help`} className="muted">
            {text.reasonHelp}
          </small>
          {!changed && !validityChanged && (
            <small className="muted" role="status">
              {text.unchangedContent}
            </small>
          )}
          <p>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !reason.trim() || !(changed || validityChanged)}
            >
              {text.newVersionSubmit}
            </button>
          </p>
        </form>
      )}

      <div className="stack">
        <h3>{text.deleteHeading}</h3>
        {!deleting ? (
          <p>
            <button
              type="button"
              className="secondary-button danger"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              {text.deleteStart}
            </button>
          </p>
        ) : (
          <form className="confirm-panel card field-stack" onSubmit={remove}>
            <h4 tabIndex={-1} ref={deleteHeading}>
              {text.deleteHeading}
            </h4>
            <p>{text.deleteHelp}</p>
            <label htmlFor={`${id}-delete-reason`}>{text.deleteReason}</label>
            <input
              id={`${id}-delete-reason`}
              dir="auto"
              value={deleteReason}
              maxLength={1000}
              onChange={(event) => setDeleteReason(event.target.value)}
            />
            <p className="toolbar">
              <button type="submit" className="secondary-button danger" disabled={busy}>
                {text.deleteConfirm}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setDeleting(false)}
              >
                {text.cancel}
              </button>
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

/** ING-007: knowledge whose source file changed is renewed from the newer source version. */
function RenewFromSource({
  locale,
  workspaceId,
  base,
  knowledge,
  busy,
  run,
  onChanged,
  setNotice,
}: {
  locale: Locale;
  workspaceId: string;
  base: string;
  knowledge: KnowledgeDetail;
  busy: boolean;
  run: (action: () => Promise<void>, okText: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
  setNotice: (notice: { ok: boolean; text: string } | null) => void;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const sourceId = knowledge.currentVersion?.provenance['sourceId'];
  const workspaceBase = `/workspaces/${workspaceId}`;
  const [source, setSource] = useState<SourceInfo | null | 'none'>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [reason, setReason] = useState(text.renewDefaultReason);

  useEffect(() => {
    if (typeof sourceId !== 'string') {
      setSource('none');
      return;
    }
    let active = true;
    apiGet<{ source: SourceInfo }>(`${workspaceBase}/sources/${sourceId}`)
      .then((result) => active && setSource(result.source))
      .catch(() => active && setSource('none'));
    return () => {
      active = false;
    };
  }, [sourceId, workspaceBase, knowledge.currentVersion?.id]);

  const current =
    source && source !== 'none'
      ? source.versions.find((item) => item.id === source.currentVersionId)
      : undefined;

  async function renew(event: FormEvent) {
    event.preventDefault();
    if (!current || busy || !reason.trim()) return;
    await run(async () => {
      const result = await apiSend<{ knowledge: KnowledgeDetail }>(
        'POST',
        `${base}/versions`,
        { sourceVersionId: current.id, acceptPartial, reason: reason.trim() },
        { version: knowledge.version },
      );
      await onChanged();
      setNotice({
        ok: true,
        text: fill(text.renewDone, {
          n: formatNumber(locale, result.knowledge.currentVersion?.versionNo ?? 0),
        }),
      });
    }, '');
  }

  const vars = (item: NonNullable<typeof current>, info: SourceInfo) => ({
    n: formatNumber(locale, item.versionNo),
    title: info.title,
    status: text.sourceStatuses[item.status],
  });

  return (
    <form className="highlight field-stack" onSubmit={renew}>
      <h3>{text.staleHeading}</h3>
      <p>{text.staleText}</p>
      <h4>{text.renewHeading}</h4>
      {source === null && <p role="status">{text.renewChecking}</p>}
      {source === 'none' && <p role="status">{text.renewNone}</p>}
      {source && source !== 'none' && current && (
        <>
          <p role="status">
            {current.status === 'indexed'
              ? fill(text.renewReady, vars(current, source))
              : current.status === 'partial'
                ? fill(text.renewPartial, vars(current, source))
                : ['rejected', 'failed'].includes(current.status)
                  ? fill(text.renewBlocked, vars(current, source))
                  : fill(text.renewProcessing, vars(current, source))}
          </p>
          {current.status === 'partial' && (
            <label className="mode">
              <input
                type="checkbox"
                checked={acceptPartial}
                onChange={(event) => setAcceptPartial(event.target.checked)}
              />{' '}
              {text.renewAcceptPartial}
            </label>
          )}
          <label htmlFor={`${id}-reason`}>{text.reasonLabel}</label>
          <input
            id={`${id}-reason`}
            dir="auto"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
          <p>
            <button
              type="submit"
              className="primary-button"
              disabled={
                busy ||
                !reason.trim() ||
                !(current.status === 'indexed' || (current.status === 'partial' && acceptPartial))
              }
            >
              {fill(text.renewSubmit, { n: formatNumber(locale, current.versionNo) })}
            </button>
          </p>
        </>
      )}
    </form>
  );
}
