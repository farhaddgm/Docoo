'use client';

import {
  monitorDelayChoices,
  monitorLimits,
  monitorPresets,
  monitorSettingDefinitions,
  type MonitorPreset,
  type MonitorSettingDefinition,
  type MonitorSettingKey,
  type MonitorSettingValue,
} from '@docoo/contracts';
import { useCallback, useEffect, useId, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { PanelsSkeleton } from '../skeleton';
import { monitorMessages, optionLabel } from './messages';
import {
  applyPreset,
  BATCH,
  changedKeys,
  draftFrom,
  presetChanges,
  saveItems,
  textToWords,
  validateDraft,
  withDetectedPreset,
  wordsToText,
  type Draft,
} from './settings-model';

import './monitor.css';

const GROUPS = ['general', 'viewer', 'voice'] as const;

/**
 * The page of the monitor settings (ADR-0056 §8): which monitors are on, the ready profiles, and
 * for every kind of detail whether a monitor shows it. Only the owner reaches it. The values are
 * ordinary workspace settings, so history and restore come with them.
 */
export function MonitorSettings({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const messages = monitorMessages(locale);
  const text = messages.settings;
  const base = `/workspaces/${workspaceId}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');

  const load = useCallback(async () => {
    try {
      const effective = await apiGet<{ config: { values: Record<string, unknown> } }>(
        `${base}/settings/effective?scopeType=workspace&scopeId=${workspaceId}`,
      );
      const values = draftFrom(effective.config.values);
      setDraft(values);
      setSaved(values);
      setFailure('');
    } catch {
      setFailure(text.loadFailed);
    }
  }, [base, text.loadFailed, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure && !draft) return <p className="notice error">{failure}</p>;
  if (!draft || !saved) return <PanelsSkeleton label={text.loading} count={3} />;

  const problems = validateDraft(draft);
  const problemKeys = new Set(problems.map((problem) => problem.key));
  const dirty = changedKeys(draft, saved).length > 0;
  const set = (key: MonitorSettingKey, value: MonitorSettingValue) =>
    setDraft(withDetectedPreset({ ...draft, [key]: value }));

  async function save() {
    if (!draft || !saved || problems.length > 0) return;
    const items = saveItems(draft, saved);
    if (items.length === 0) {
      setMessage(text.nothing);
      return;
    }
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      for (let at = 0; at < items.length; at += BATCH) {
        await apiSend('PUT', `${base}/settings/assignments/batch`, {
          scopeType: 'workspace',
          scopeId: workspaceId,
          items: items.slice(at, at + BATCH),
          reason: 'monitor settings',
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

  return (
    <div className="stack monitor-settings">
      <p className="muted">{text.building}</p>
      <p className="notice warn">{text.audienceWarning}</p>
      <p className="notice info">{text.alwaysHidden}</p>

      <section className="card stack" aria-labelledby="monitor-preset">
        <h2 id="monitor-preset">{text.presetTitle}</h2>
        <p className="muted">{text.presetHint}</p>
        <div className="monitor-presets" role="radiogroup" aria-labelledby="monitor-preset">
          {[...monitorPresets, 'custom' as const].map((preset) => {
            const current = draft['monitor.preset'] === preset;
            const info = text.presets[preset];
            const count = preset === 'custom' ? 0 : presetChanges(draft, preset).length;
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={current}
                disabled={preset === 'custom'}
                className={current ? 'monitor-preset monitor-preset-on' : 'monitor-preset'}
                onClick={() => setDraft(applyPreset(draft, preset as MonitorPreset))}
              >
                <strong>{info.name}</strong>
                <small>{info.text}</small>
                {!current && preset !== 'custom' && count > 0 && (
                  <small className="muted">
                    {text.changesIfPicked} {formatNumber(locale, count)}
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {GROUPS.map((group) => (
        <section className="card stack" key={group} aria-labelledby={`monitor-group-${group}`}>
          <h2 id={`monitor-group-${group}`}>{text.groups[group]}</h2>
          <p className="muted">{text.groupHints[group]}</p>
          {monitorSettingDefinitions
            .filter(
              (definition) => definition.group === group && definition.key !== 'monitor.preset',
            )
            .map((definition) => (
              <SettingRow
                key={definition.key}
                definition={definition}
                value={draft[definition.key]}
                locale={locale}
                invalid={problemKeys.has(definition.key)}
                onChange={(value) => set(definition.key, value)}
              />
            ))}
        </section>
      ))}

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
        {dirty && <span className="muted">{text.unsaved}</span>}
      </div>
      {message && (
        <p className="notice ok" role="status">
          {message}
        </p>
      )}
      {failure && (
        <p className="notice error" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

/** One setting: its sentence, and the control that fits the kind of value it takes. */
function SettingRow({
  definition,
  value,
  locale,
  invalid,
  onChange,
}: {
  readonly definition: MonitorSettingDefinition;
  readonly value: MonitorSettingValue;
  readonly locale: Locale;
  readonly invalid: boolean;
  readonly onChange: (value: MonitorSettingValue) => void;
}) {
  const messages = monitorMessages(locale);
  const id = useId();
  const label = locale === 'en' ? definition.en : definition.fa;
  const key = definition.key;
  let control;
  switch (definition.kind) {
    case 'boolean':
      return (
        <label className="voice-check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />{' '}
          {label}
        </label>
      );
    case 'choice':
      control = (
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)}>
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(messages, key, option)}
            </option>
          ))}
        </select>
      );
      break;
    case 'integer':
      control =
        key === 'monitor.delay_s' ? (
          <select
            id={id}
            value={String(value)}
            onChange={(event) => onChange(Number(event.target.value))}
          >
            {[...new Set<number>([...monitorDelayChoices, Number(value)])]
              .filter((delay) => Number.isFinite(delay))
              .sort((a, b) => a - b)
              .map((delay) => (
                <option key={delay} value={delay}>
                  {formatNumber(locale, delay)} {messages.settings.delayUnit}
                </option>
              ))}
          </select>
        ) : (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={definition.min}
            max={definition.max}
            step={1}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(event) =>
              onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
            }
          />
        );
      break;
    case 'number':
      control = (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={definition.min}
          max={definition.max}
          step={0.25}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
          }
        />
      );
      break;
    case 'words':
      control = <WordsField id={id} value={value} onChange={onChange} />;
      break;
  }
  return (
    <div className="field-stack">
      <label htmlFor={id}>{label}</label>
      {control}
      {definition.kind === 'words' && (
        <small className="muted">{messages.settings.blockedWordsHint}</small>
      )}
      {invalid && (
        <small className="notice error" role="alert">
          {messages.settings.problem}
        </small>
      )}
    </div>
  );
}

/**
 * The blocked words, one per line. The text is kept as typed (a half-typed line must survive) and
 * the clean list goes up on every change; when the list is replaced from outside, the text follows.
 */
function WordsField({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: MonitorSettingValue;
  readonly onChange: (value: string[]) => void;
}) {
  const [typed, setTyped] = useState(() => wordsToText(value));
  useEffect(() => {
    setTyped((current) =>
      JSON.stringify(textToWords(current)) === JSON.stringify(value) ? current : wordsToText(value),
    );
  }, [value]);
  return (
    <textarea
      id={id}
      rows={4}
      maxLength={monitorLimits.blockedWords.maxItems * (monitorLimits.blockedWords.maxLength + 1)}
      value={typed}
      onChange={(event) => {
        setTyped(event.target.value);
        onChange(textToWords(event.target.value));
      }}
    />
  );
}
