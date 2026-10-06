'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { agentMessages, fill } from '../../agents/agent-messages';
import {
  agentRoles,
  type AgentRole,
  type Definition,
  type ProjectProfile,
  type ProjectRoleDetail,
} from '../../agents/agent-types';
import { diffLines, diffText, hasChanges } from '../../agents/diff';
import { DiffView } from '../../agents/diff-view';
import { RoleEditor } from '../../agents/role-editor';
import { explainError, Notice, useAction } from '../../use-action';

/** What a form below a role asks for: a reason, then the action. */
type Form =
  { kind: 'copy'; role: AgentRole } | { kind: 'pin'; role: AgentRole; versionId?: string };

/**
 * FR-AGT-001..003, UX §9: the definition each role runs with in this project. A project is
 * pinned to a default version, or it has its own independent copy that only it edits.
 */
export function AgentsPanel({
  locale,
  workspaceId,
  projectId,
  readOnly,
  refreshKey,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  readOnly: boolean;
  refreshKey: number;
}) {
  const text = agentMessages(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}/agents`;
  const [profiles, setProfiles] = useState<ProjectProfile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<AgentRole | null>(null);
  const [detail, setDetail] = useState<ProjectRoleDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [reason, setReason] = useState('');
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);
  const formId = useId();

  const loadProfiles = useCallback(async () => {
    setProfiles((await apiGet<{ items: ProjectProfile[] }>(base)).items);
  }, [base]);

  const loadDetail = useCallback(
    async (role: AgentRole) => {
      setDetail(await apiGet<ProjectRoleDetail>(`${base}/${role}`));
    },
    [base],
  );

  useEffect(() => {
    loadProfiles().catch(() => setFailed(true));
  }, [loadProfiles, refreshKey]);

  useEffect(() => {
    if (!editing) {
      setDetail(null);
      return;
    }
    loadDetail(editing).catch(() => setNotice({ ok: false, text: text.failed }));
  }, [editing, loadDetail, setNotice, text]);

  const headers = () => ({ 'idempotency-key': idempotencyKey() });

  async function copyDefault(role: AgentRole) {
    const done = await run(async () => {
      await apiSend(
        'POST',
        `${base}/${role}/copy-default`,
        { reason: reason.trim() },
        { headers: headers() },
      );
      await loadProfiles();
    }, text.copied);
    if (done) {
      setForm(null);
      setReason('');
      setEditing(role);
    }
  }

  async function pin(role: AgentRole, versionId: string | undefined) {
    let changed = true;
    const done = await run(async () => {
      const result = await apiSend<{ changed: boolean }>(
        'POST',
        `${base}/${role}/pin`,
        { reason: reason.trim(), ...(versionId ? { versionId } : {}) },
        { headers: headers() },
      );
      changed = result.changed;
      await loadProfiles();
      if (editing === role) await loadDetail(role);
    }, '');
    if (done) {
      setNotice({ ok: true, text: changed ? text.pinned : text.nothingToPin });
      setForm(null);
      setReason('');
    }
  }

  if (failed) {
    return (
      <p className="notice error" role="alert">
        {text.failed}
      </p>
    );
  }
  if (!profiles) return <p role="status">{text.loading}</p>;

  const formFor = (role: AgentRole) => (form?.role === role ? form : null);
  const reasonOk = reason.trim().length >= 3;

  return (
    <section className="card stack" aria-labelledby="project-agents-heading">
      <h2 id="project-agents-heading">{text.projectHeading}</h2>
      <p className="muted">{text.projectHelp}</p>
      <p className="muted">{text.runningNote}</p>
      <Notice notice={notice} />
      <ul className="agent-list">
        {agentRoles.map((role) => {
          const profile = profiles.find((item) => item.role === role);
          if (!profile) return null;
          const name = text.roles[role].name;
          const n = formatNumber(locale, profile.version.sequence);
          const state = !profile.pinned
            ? fill(text.projectState.notPinned, { n })
            : profile.customized
              ? fill(text.projectState.custom, { n })
              : fill(text.projectState.pinned, { n });
          const open = editing === role;
          const active = formFor(role);
          return (
            <li key={role} className="agent-row card stack">
              <h3>{name}</h3>
              <p className="muted">{text.roles[role].mission}</p>
              <p>
                <span className={`badge ${profile.customized ? 'state-warn' : ''}`}>{state}</span>
              </p>
              {profile.behindDefault && (
                <p className="notice error" role="status">
                  {fill(text.behind, {
                    n,
                    latest: formatNumber(locale, profile.defaultVersion.sequence),
                  })}
                </p>
              )}
              {!readOnly && (
                <p className="toolbar">
                  {!profile.customized && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      aria-label={`${text.copyDefault}: ${name}`}
                      onClick={() => {
                        setForm({ kind: 'copy', role });
                        setReason('');
                      }}
                    >
                      {text.copyDefault}
                    </button>
                  )}
                  {profile.customized && (
                    <button
                      data-write-action
                      type="button"
                      className="secondary-button"
                      aria-expanded={open}
                      aria-label={`${open ? text.closeEditor : text.editCopy}: ${name}`}
                      onClick={() => setEditing(open ? null : role)}
                    >
                      {open ? text.closeEditor : text.editCopy}
                    </button>
                  )}
                  {(profile.customized || profile.behindDefault) && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      aria-label={`${text.useDefault}: ${name}`}
                      onClick={() => {
                        setForm({ kind: 'pin', role });
                        setReason('');
                      }}
                    >
                      {text.useDefault}
                    </button>
                  )}
                </p>
              )}

              {active && (
                <form
                  data-write-action
                  className="field-stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!reasonOk) return;
                    if (active.kind === 'copy') void copyDefault(role);
                    else void pin(role, active.versionId);
                  }}
                >
                  <p className="muted">
                    {active.kind === 'copy'
                      ? text.copyWarning
                      : active.versionId
                        ? text.pinOwn
                        : text.useDefaultHelp}
                  </p>
                  <label htmlFor={`${formId}-${role}`}>
                    {active.kind === 'copy' ? text.copyReason : text.pinReason}
                  </label>
                  <input
                    id={`${formId}-${role}`}
                    dir="auto"
                    value={reason}
                    maxLength={1000}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <p className="toolbar">
                    <button type="submit" className="primary-button" disabled={busy || !reasonOk}>
                      {active.kind === 'copy' ? text.copyConfirm : text.pinConfirm}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setForm(null)}
                    >
                      {text.cancel}
                    </button>
                  </p>
                </form>
              )}

              {open && detail && detail.role === role && (
                <Workbench
                  locale={locale}
                  workspaceId={workspaceId}
                  detail={detail}
                  busy={busy}
                  onPin={(versionId) => {
                    setForm({ kind: 'pin', role, versionId });
                    setReason('');
                  }}
                  submit={async (changes, why) => {
                    const result = await apiSend<{ definition: Definition }>(
                      'PATCH',
                      `${base}/${role}`,
                      { changes, reason: why, expectedSequence: detail.latestSequence },
                      { headers: headers() },
                    );
                    await Promise.all([loadDetail(role), loadProfiles()]);
                    setNotice({
                      ok: true,
                      text: fill(text.savedProject, {
                        n: formatNumber(locale, result.definition.sequence),
                      }),
                    });
                    return result.definition;
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The opened role of a project: compare with the default, edit the copy, go back to a copy. */
function Workbench({
  locale,
  workspaceId,
  detail,
  busy,
  onPin,
  submit,
}: {
  locale: Locale;
  workspaceId: string;
  detail: ProjectRoleDetail;
  busy: boolean;
  onPin: (versionId: string) => void;
  submit: (changes: Record<string, unknown>, reason: string) => Promise<Definition>;
}) {
  const text = agentMessages(locale);
  const mine = detail.definition;
  const theirs = detail.defaultDefinition;
  const comparison = [
    { label: text.sections.principles, lines: diffLines(theirs.principles, mine.principles) },
    { label: text.sections.duties, lines: diffLines(theirs.duties, mine.duties) },
    { label: text.sections.prompt, lines: diffText(theirs.promptTemplate, mine.promptTemplate) },
  ].filter((item) => hasChanges(item.lines));

  return (
    <div className="stack">
      <details>
        <summary>{text.compare}</summary>
        <p className="muted">
          {fill(text.versionLabel, { n: formatNumber(locale, theirs.sequence) })} →{' '}
          {fill(text.versionLabel, { n: formatNumber(locale, mine.sequence) })}
        </p>
        {comparison.length === 0 ? (
          <p className="muted">{text.noChanges}</p>
        ) : (
          comparison.map((item) => (
            <div key={item.label}>
              <h4>{item.label}</h4>
              <DiffView lines={item.lines} text={text} />
            </div>
          ))
        )}
      </details>

      <RoleEditor
        key={mine.id}
        locale={locale}
        workspaceId={workspaceId}
        base={mine}
        reference={detail}
        serverWarnings={detail.modelWarnings}
        saveLabel={text.saveProject}
        submit={submit}
      />

      <section aria-labelledby={`own-${mine.id}`}>
        <h4 id={`own-${mine.id}`}>{text.ownVersions}</h4>
        <ol className="version-list">
          {detail.ownVersions.map((item) => {
            const label = fill(text.versionLabel, { n: formatNumber(locale, item.sequence) });
            return (
              <li key={item.id} className="version-row">
                <strong>{label}</strong>{' '}
                {item.id === mine.id && <span className="badge state-passed">{text.active}</span>}{' '}
                <span className="muted">{formatDateTime(locale, item.createdAt)}</span>
                <p dir="auto">{item.reason}</p>
                {item.id !== mine.id && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    aria-label={`${text.pinOwn}: ${label}`}
                    onClick={() => onPin(item.id)}
                  >
                    {text.pinOwn}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
