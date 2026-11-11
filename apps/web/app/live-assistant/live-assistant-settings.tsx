'use client';

import {
  type LiveVoiceCheckFailure,
  accessScopeModes,
  assistantAccessLevels,
  confirmStrictnessLevels,
  liveAssistantLanguages,
  liveAssistantLimits,
  liveAssistantListeningModes,
  liveAssistantModes,
  t3Categories,
  type LiveAssistantClientConfig,
  type LiveAssistantSettingKey,
} from '@docoo/contracts';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

import { ModelPicker } from '../[locale]/settings/model-picker';
import { ApiError, apiGet, apiSend } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import {
  changedKeys,
  draftFrom,
  BATCH,
  effectiveRule,
  saveOrder,
  validateDraft,
  type Draft,
  type Problem,
} from './settings-model';
import { liveReadApi } from './live-api';
import { fillText, liveSettingsMessages } from './settings-messages';
import { PanelsSkeleton } from '../skeleton';

interface Connection {
  id: string;
  name: string;
  provider: string;
  status: string;
}

interface ProjectOption {
  id: string;
  code: string;
  title: string;
}

/** Providers with a live voice model; the voice connection is chosen among these. */
const VOICE_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'elevenlabs', 'gemini']);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function Field({
  label,
  hint,
  problem,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly problem?: string | undefined;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field-stack">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="muted">{hint}</small>}
      {problem && (
        <small className="notice error" role="alert">
          {problem}
        </small>
      )}
    </div>
  );
}

/**
 * The page of the voice assistant's own settings (ADR-0055 §4-8, HUG-010): what it may reach and
 * do, which AI and model it uses, how it listens, what it may spend, how every change is confirmed.
 * Only the owner reaches it. The values are ordinary workspace settings, so history and restore
 * come with them; they are saved together, all or none.
 */
export function LiveAssistantSettings({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const text = liveSettingsMessages(locale);
  const base = `/workspaces/${workspaceId}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [models, setModels] = useState<string[]>([]);
  /** For an ElevenLabs connection: the speaking models and the voices of its catalog. */
  const [speech, setSpeech] = useState<{
    models: string[];
    voices: { id: string; name: string }[];
  }>({ models: [], voices: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  /** What the server says about the saved settings: can the assistant be written to now? */
  const [readiness, setReadiness] = useState<LiveAssistantClientConfig | null>(null);
  /** The result of the last voice-link check: null before one, a failure kind or `ok`. */
  const [voiceLink, setVoiceLink] = useState<'running' | 'ok' | LiveVoiceCheckFailure | null>(null);

  const load = useCallback(async () => {
    try {
      const scope = `?scopeType=workspace&scopeId=${workspaceId}`;
      const [effective, list] = await Promise.all([
        apiGet<{ config: { values: Record<string, unknown> } }>(
          `${base}/settings/effective${scope}`,
        ),
        apiGet<{ items: Connection[] }>(`${base}/provider-connections`),
      ]);
      const values = draftFrom(effective.config.values);
      setDraft(values);
      setSaved(values);
      setConnections(list.items.filter((item) => item.status !== 'disabled'));
      setFailure('');
      // A nicety: the page works without it, so a failure here only leaves the status out.
      liveReadApi
        .config(workspaceId)
        .then(setReadiness)
        .catch(() => setReadiness(null));
    } catch {
      setFailure(text.loadFailed);
    }
  }, [base, text.loadFailed, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    apiGet<{ items: ProjectOption[] }>(`${base}/projects?limit=100`)
      .then((result) => active && setProjects(result.items))
      .catch(() => active && setProjects([]));
    return () => {
      active = false;
    };
  }, [base]);

  const connectionId = draft ? asString(draft['live_assistant.connection_id']) : '';
  useEffect(() => {
    if (!connectionId) {
      setModels([]);
      return;
    }
    let active = true;
    apiGet<{ catalog: { models: { id: string }[] } | null }>(
      `${base}/provider-connections/${connectionId}/models`,
    )
      .then((result) => active && setModels((result.catalog?.models ?? []).map((m) => m.id)))
      .catch(() => active && setModels([]));
    return () => {
      active = false;
    };
  }, [base, connectionId]);

  const chosenBrand = connections.find((item) => item.id === connectionId)?.provider ?? '';
  const isEleven = chosenBrand === 'elevenlabs';
  useEffect(() => {
    if (!isEleven) {
      setSpeech({ models: [], voices: [] });
      return;
    }
    let active = true;
    apiGet<{
      models: { id: string; kind: string }[];
      voices: { id: string; name: string }[];
    }>(`${base}/voice/catalog?provider=elevenlabs`)
      .then((result) => {
        if (!active) return;
        setSpeech({
          models: result.models.filter((m) => m.kind === 'tts').map((m) => m.id),
          voices: result.voices.map((v) => ({ id: v.id, name: v.name })),
        });
      })
      .catch(() => active && setSpeech({ models: [], voices: [] }));
    return () => {
      active = false;
    };
  }, [base, isEleven]);

  if (!draft || !saved) {
    return failure ? (
      <p className="notice error" role="alert">
        {failure}
      </p>
    ) : (
      <PanelsSkeleton label={text.loading} count={2} />
    );
  }

  // Live voice exists only at providers that offer it; a connection already saved stays listed.
  const voiceConnections = connections.filter((item) => VOICE_PROVIDERS.has(item.provider));

  const problems = validateDraft(draft);
  const problemFor = (key: LiveAssistantSettingKey): string | undefined => {
    const found: Problem | undefined = problems.find((item) => item.key === key);
    return found ? text.problems[found.code] : undefined;
  };
  const set = (key: LiveAssistantSettingKey, value: unknown) =>
    setDraft({ ...draft, [key]: value });
  const bool = (key: LiveAssistantSettingKey) => draft[key] === true;
  const dirty = changedKeys(draft, saved).length > 0;
  const name = asString(draft['live_assistant.display_name']).trim() || text.title;

  async function save() {
    if (!draft || !saved || problems.length > 0) return;
    const keys = saveOrder(changedKeys(draft, saved));
    if (keys.length === 0) {
      setMessage(text.nothing);
      return;
    }
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      for (let at = 0; at < keys.length; at += BATCH) {
        await apiSend('PUT', `${base}/settings/assignments/batch`, {
          scopeType: 'workspace',
          scopeId: workspaceId,
          items: keys.slice(at, at + BATCH).map((key) => ({ key, value: draft[key] })),
          reason: 'live assistant settings',
        });
      }
      setMessage(text.saved);
    } catch (error) {
      setFailure(error instanceof ApiError && error.status === 403 ? text.denied : text.saveFailed);
    } finally {
      await load();
      setBusy(false);
    }
  }

  function numberField(
    key: LiveAssistantSettingKey,
    label: string,
    range: { readonly min: number; readonly max: number },
    step: string,
  ) {
    const value = draft?.[key];
    return (
      <Field
        label={label}
        hint={fillText(text.limits.range, {
          min: formatNumber(locale, range.min),
          max: formatNumber(locale, range.max),
        })}
        problem={problemFor(key)}
      >
        {(id) => (
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={range.min}
            max={range.max}
            step={step}
            value={typeof value === 'number' && Number.isFinite(value) ? String(value) : ''}
            onChange={(event) =>
              set(key, event.target.value === '' ? Number.NaN : Number(event.target.value))
            }
          />
        )}
      </Field>
    );
  }

  // The sentence on the page comes from the rule the settings would enforce, no other reading.
  const rule = effectiveRule(draft);
  let summary = fillText(text.access.summaryNone, { name });
  if (rule) {
    const phrases = text.access.scopePhrase;
    const chosen = rule.scope.mode === 'selected_projects' ? rule.scope : null;
    const count = formatNumber(locale, chosen?.projectIds.length ?? 0);
    let scope = phrases.all_projects;
    if (rule.scope.mode === 'backoffice') scope = phrases.backoffice;
    else if (chosen) {
      if (chosen.projectIds.length === 0) {
        scope = chosen.includeCurrent ? phrases.currentOnly : '';
      } else {
        scope = fillText(chosen.includeCurrent ? phrases.selectedAndCurrent : phrases.selected, {
          n: count,
        });
      }
    }
    summary = scope
      ? fillText(rule.level === 'act' ? text.access.summaryAct : text.access.summaryRead, {
          name,
          scope,
        })
      : fillText(text.access.summaryNone, { name });
  }

  const selectedIds = asList(draft['live_assistant.access_project_ids']);
  const enabledT3 = asList(draft['live_assistant.t3_categories']);
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...new Set([...list, value])] : list.filter((item) => item !== value);

  return (
    <div className="stack live-settings">
      {readiness && (
        <div className="stack" role="status">
          <p className={readiness.textReady ? 'notice info' : 'notice warn'}>
            {readiness.textReady ? (
              <>
                <strong>{text.status.ready}</strong>{' '}
                {readiness.executorSource === 'own'
                  ? text.status.readyOwn
                  : text.status.readyWorkspace}
              </>
            ) : (
              text.status.textNeeds[readiness.textUnavailableReason ?? 'executor_not_configured']
            )}
          </p>
          <p className="muted">{text.status.voiceLater}</p>
          <div className="stack">
            <button
              type="button"
              className="button secondary"
              disabled={voiceLink === 'running'}
              onClick={() => {
                setVoiceLink('running');
                liveReadApi
                  .voiceCheck(workspaceId)
                  .then((result) =>
                    setVoiceLink(result.ok ? 'ok' : (result.failure ?? 'unexpected')),
                  )
                  .catch(() => setVoiceLink('network'));
              }}
            >
              {voiceLink === 'running'
                ? text.status.voiceCheck.running
                : text.status.voiceCheck.button}
            </button>
            <small className="muted">{text.status.voiceCheck.note}</small>
            {voiceLink === 'ok' && <p className="notice info">{text.status.voiceCheck.ok}</p>}
            {voiceLink !== null && voiceLink !== 'ok' && voiceLink !== 'running' && (
              <p className="notice warn" role="alert">
                {text.status.voiceCheck.failed} {text.status.voiceCheck.failures[voiceLink]}
              </p>
            )}
          </div>
          {changedKeys(draft, saved).length > 0 && <p className="muted">{text.status.unsaved}</p>}
        </div>
      )}

      <section className="card stack" aria-labelledby="la-general">
        <h2 id="la-general">{text.general.title}</h2>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={bool('live_assistant.enabled')}
            onChange={(event) => set('live_assistant.enabled', event.target.checked)}
          />{' '}
          {text.general.enabled}
        </label>
        <small className="muted">{text.general.enabledHint}</small>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={bool('live_assistant.disclosure_accepted')}
            onChange={(event) => set('live_assistant.disclosure_accepted', event.target.checked)}
          />{' '}
          {text.general.disclosure}
        </label>
        {problemFor('live_assistant.disclosure_accepted') && (
          <small className="notice error" role="alert">
            {problemFor('live_assistant.disclosure_accepted')}
          </small>
        )}
        <Field label={text.general.displayName} problem={problemFor('live_assistant.display_name')}>
          {(id) => (
            <input
              id={id}
              type="text"
              maxLength={40}
              value={asString(draft['live_assistant.display_name'])}
              onChange={(event) => set('live_assistant.display_name', event.target.value)}
            />
          )}
        </Field>
        <Field label={text.general.spokenName} hint={text.general.spokenHint}>
          {(id) => (
            <input
              id={id}
              type="text"
              maxLength={40}
              value={asString(draft['live_assistant.spoken_name'])}
              onChange={(event) => set('live_assistant.spoken_name', event.target.value)}
            />
          )}
        </Field>
      </section>

      <section className="card stack" aria-labelledby="la-access">
        <h2 id="la-access">{text.access.title}</h2>
        <p className="muted">{text.access.intro}</p>

        <fieldset className="field-stack">
          <legend>{text.access.scopeLegend}</legend>
          {accessScopeModes.map((mode) => (
            <label key={mode} className="voice-check">
              <input
                type="radio"
                name="la-scope"
                checked={draft['live_assistant.access_scope'] === mode}
                onChange={() => set('live_assistant.access_scope', mode)}
              />{' '}
              <strong>{text.access.scopes[mode].label}</strong>
              <small className="muted"> — {text.access.scopes[mode].hint}</small>
            </label>
          ))}
        </fieldset>

        {draft['live_assistant.access_scope'] === 'selected_projects' && (
          <fieldset className="field-stack">
            <legend>{text.access.projects}</legend>
            {projects.length === 0 && <p className="muted">{text.access.noProjects}</p>}
            {projects.map((project) => (
              <label key={project.id} className="voice-check">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(project.id)}
                  onChange={(event) =>
                    set(
                      'live_assistant.access_project_ids',
                      toggle(selectedIds, project.id, event.target.checked),
                    )
                  }
                />{' '}
                {project.title} <small className="muted">({project.code})</small>
              </label>
            ))}
            <label className="voice-check">
              <input
                type="checkbox"
                checked={bool('live_assistant.access_include_current')}
                onChange={(event) =>
                  set('live_assistant.access_include_current', event.target.checked)
                }
              />{' '}
              {text.access.includeCurrent}
            </label>
            {problemFor('live_assistant.access_project_ids') && (
              <small className="notice error" role="alert">
                {problemFor('live_assistant.access_project_ids')}
              </small>
            )}
          </fieldset>
        )}

        <fieldset className="field-stack">
          <legend>{text.access.levelLegend}</legend>
          {assistantAccessLevels.map((level) => (
            <label key={level} className="voice-check">
              <input
                type="radio"
                name="la-level"
                checked={draft['live_assistant.access_level'] === level}
                onChange={() => set('live_assistant.access_level', level)}
              />{' '}
              <strong>{text.access.levels[level].label}</strong>
              <small className="muted"> — {text.access.levels[level].hint}</small>
            </label>
          ))}
        </fieldset>

        <p className="notice" role="status">
          <strong>{text.access.summaryTitle}:</strong> {summary}
        </p>
      </section>

      {/* From here on the blocks are short enough to stand two to a row. */}
      <div className="settings-columns">
        <section className="card stack" aria-labelledby="la-model">
          <h2 id="la-model">{text.model.title}</h2>
          <p className="muted">{text.model.intro}</p>
          <Field label={text.model.mode}>
            {(id) => (
              <select
                id={id}
                value={asString(draft['live_assistant.mode'])}
                onChange={(event) => set('live_assistant.mode', event.target.value)}
              >
                {liveAssistantModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {text.model.modes[mode]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={text.model.connection}>
            {(id) => (
              <select
                id={id}
                value={connectionId}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    'live_assistant.connection_id': event.target.value,
                    'live_assistant.model': '',
                  });
                }}
              >
                <option value="">{text.model.noConnection}</option>
                {voiceConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({connection.provider})
                  </option>
                ))}
                {/* A saved connection that was disabled or removed must not look like "none". */}
                {connectionId && !voiceConnections.some((c) => c.id === connectionId) && (
                  <option value={connectionId}>{text.model.unknownConnection}</option>
                )}
              </select>
            )}
          </Field>
          {voiceConnections.length === 0 && (
            <small className="muted">{text.model.noConnections}</small>
          )}
          {isEleven && <p className="notice info">{text.model.elevenlabs.note}</p>}
          <Field
            label={isEleven ? text.model.elevenlabs.modelId : text.model.modelId}
            hint={isEleven ? text.model.elevenlabs.modelHint : text.model.modelHint}
            problem={problemFor('live_assistant.model')}
          >
            {(id) => (
              <>
                <input
                  id={id}
                  type="text"
                  list={`${id}-models`}
                  maxLength={200}
                  dir="ltr"
                  value={asString(draft['live_assistant.model'])}
                  onChange={(event) => set('live_assistant.model', event.target.value)}
                />
                <datalist id={`${id}-models`}>
                  {(isEleven ? speech.models : models).map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field
            label={text.model.voice}
            hint={isEleven ? text.model.elevenlabs.voiceHint : text.model.voiceHint}
          >
            {(id) => (
              <>
                <input
                  id={id}
                  type="text"
                  list={`${id}-voices`}
                  maxLength={200}
                  dir="ltr"
                  value={asString(draft['live_assistant.voice_id'])}
                  onChange={(event) => set('live_assistant.voice_id', event.target.value)}
                />
                <datalist id={`${id}-voices`}>
                  {speech.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label={text.model.language}>
            {(id) => (
              <select
                id={id}
                value={asString(draft['live_assistant.language'])}
                onChange={(event) => set('live_assistant.language', event.target.value)}
              >
                {liveAssistantLanguages.map((language) => (
                  <option key={language} value={language}>
                    {text.model.languages[language]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <h3>{text.model.executor}</h3>
          <ModelPicker
            locale={locale}
            workspaceId={workspaceId}
            idPrefix="la-executor"
            inheritLabel={text.model.executorInherit}
            showCapabilityNote={false}
            connectionId={asString(draft['live_assistant.executor_connection_id'])}
            model={asString(draft['live_assistant.executor_model'])}
            onChange={(connection, model) =>
              setDraft({
                ...draft,
                'live_assistant.executor_connection_id': connection,
                'live_assistant.executor_model': model,
              })
            }
          />
          {problemFor('live_assistant.executor_model') && (
            <small className="notice error" role="alert">
              {problemFor('live_assistant.executor_model')}
            </small>
          )}
        </section>

        <section className="card stack" aria-labelledby="la-listening">
          <h2 id="la-listening">{text.listening.title}</h2>
          <Field label={text.listening.mode}>
            {(id) => (
              <select
                id={id}
                value={asString(draft['live_assistant.listening_mode'])}
                onChange={(event) => set('live_assistant.listening_mode', event.target.value)}
              >
                {liveAssistantListeningModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {text.listening.modes[mode]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {numberField(
            'live_assistant.idle_sleep_s',
            text.listening.idle,
            liveAssistantLimits.idleSleepS,
            '1',
          )}
          <small className="muted">{text.listening.idleHint}</small>
          <label className="voice-check">
            <input
              type="checkbox"
              checked={bool('live_assistant.wake_enabled')}
              onChange={(event) => set('live_assistant.wake_enabled', event.target.checked)}
            />{' '}
            {text.listening.wake}
          </label>
          <small className="muted">{text.listening.wakeHint}</small>
          <Field label={text.listening.wakePhrase}>
            {(id) => (
              <input
                id={id}
                type="text"
                maxLength={60}
                dir="ltr"
                value={asString(draft['live_assistant.wake_phrase'])}
                onChange={(event) => set('live_assistant.wake_phrase', event.target.value)}
              />
            )}
          </Field>
        </section>

        <section className="card stack" aria-labelledby="la-limits">
          <h2 id="la-limits">{text.limits.title}</h2>
          <p className="muted">{text.limits.intro}</p>
          {numberField(
            'live_assistant.session_cost_cap_usd',
            text.limits.sessionCost,
            liveAssistantLimits.sessionCostCapUsd,
            '0.5',
          )}
          {numberField(
            'live_assistant.daily_cost_cap_usd',
            text.limits.dailyCost,
            liveAssistantLimits.dailyCostCapUsd,
            '1',
          )}
          {numberField(
            'live_assistant.session_max_minutes',
            text.limits.sessionMinutes,
            liveAssistantLimits.sessionMaxMinutes,
            '1',
          )}
          {numberField(
            'live_assistant.task_cost_cap_usd',
            text.limits.taskCost,
            liveAssistantLimits.taskCostCapUsd,
            '0.05',
          )}
          {numberField(
            'live_assistant.max_actions_per_task',
            text.limits.maxActions,
            liveAssistantLimits.maxActionsPerTask,
            '1',
          )}
        </section>

        <section className="card stack" aria-labelledby="la-confirm">
          <h2 id="la-confirm">{text.confirm.title}</h2>
          <p className="muted">{text.confirm.intro}</p>
          {numberField(
            'live_assistant.confirm_timeout_s',
            text.confirm.timeout,
            liveAssistantLimits.confirmTimeoutS,
            '1',
          )}
          <Field label={text.confirm.strictness}>
            {(id) => (
              <select
                id={id}
                value={asString(draft['live_assistant.confirm_strictness'])}
                onChange={(event) => set('live_assistant.confirm_strictness', event.target.value)}
              >
                {confirmStrictnessLevels.map((level) => (
                  <option key={level} value={level}>
                    {text.confirm.strictnesses[level]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="field-stack">
            <legend>{text.confirm.t3Title}</legend>
            <p className="muted">{text.confirm.t3Intro}</p>
            {t3Categories.map((category) => (
              <label key={category} className="voice-check">
                <input
                  type="checkbox"
                  checked={enabledT3.includes(category)}
                  onChange={(event) =>
                    set(
                      'live_assistant.t3_categories',
                      toggle(enabledT3, category, event.target.checked),
                    )
                  }
                />{' '}
                {text.confirm.t3[category]}
              </label>
            ))}
          </fieldset>
        </section>

        <section className="card stack" aria-labelledby="la-privacy">
          <h2 id="la-privacy">{text.privacy.title}</h2>
          <label className="voice-check">
            <input
              type="checkbox"
              checked={bool('live_assistant.store_transcripts')}
              onChange={(event) => set('live_assistant.store_transcripts', event.target.checked)}
            />{' '}
            {text.privacy.transcripts}
          </label>
          {numberField(
            'live_assistant.transcript_retention_days',
            text.privacy.retention,
            liveAssistantLimits.transcriptRetentionDays,
            '1',
          )}
          <label className="voice-check">
            <input
              type="checkbox"
              checked={bool('live_assistant.store_audio')}
              onChange={(event) => set('live_assistant.store_audio', event.target.checked)}
            />{' '}
            {text.privacy.audio}
          </label>
          <small className="muted">{text.privacy.audioHint}</small>
        </section>
      </div>

      <div className="toolbar" role="group">
        <button
          type="button"
          className="primary-button"
          disabled={busy || !dirty || problems.length > 0}
          onClick={() => void save()}
        >
          {text.save}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft(saved);
            setMessage('');
          }}
        >
          {text.revert}
        </button>
        {message && (
          <span role="status" className="muted">
            {message}
          </span>
        )}
      </div>
      {failure && (
        <p className="notice error" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
