'use client';

import {
  estimateResearch,
  presetOf,
  RESEARCH_PRESET_IDS,
  RESEARCH_PRESETS,
  researchValuesOf,
  type ResearchPresetId,
  type ResearchUnitCost,
} from '@docoo/contracts';
import { useEffect, useId, useState } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatNumber, formatUsd, textDir, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Notice, useAction } from '../use-action';
import { ModelPicker } from './model-picker';
import { settingsMessages, type SettingsText } from './settings-messages';

type Values = Readonly<Record<string, unknown>>;

/** Where a chosen mode goes: saved on a scope right away, or handed to a form that saves later. */
export type PresetTarget =
  | {
      readonly kind: 'save';
      readonly scopeType: 'workspace' | 'topic' | 'project';
      readonly scopeId: string;
      readonly onSaved: () => void;
    }
  | {
      readonly kind: 'draft';
      readonly onChoose: (
        changes: Readonly<Record<string, boolean | number | string | null>>,
      ) => void;
    };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function factorLine(t: SettingsText['presets'], locale: Locale, factor: number): string {
  if (factor === 1) return t.factorSame;
  return fill(factor > 1 ? t.factorMore : t.factorLess, { n: formatNumber(locale, factor) });
}

/**
 * The four research modes in place of eight numbers (ADR-0048). Each card says in one sentence
 * what the mode is for and what it costs compared with the standard mode, and in dollars and
 * minutes once the workspace has run enough research to measure it. Choosing "sensitive" asks for
 * the second model first, because that mode cannot run without one.
 */
export function ResearchPresetPicker({
  locale,
  workspaceId,
  values,
  target,
  disabled = false,
}: {
  locale: Locale;
  workspaceId: string;
  /** The effective setting values the page currently shows. */
  values: Values;
  target: PresetTarget;
  disabled?: boolean;
}) {
  const t = settingsMessages(locale).presets;
  const id = useId();
  const action = useAction(() => t.failed);
  const [unit, setUnit] = useState<ResearchUnitCost | null>(null);
  const current = presetOf(values);
  const [chosen, setChosen] = useState<ResearchPresetId | null>(
    current === 'custom' ? null : current,
  );
  const [second, setSecond] = useState({
    connection: text(values['research.dual_connection_id']),
    model: text(values['research.dual_model']),
  });

  useEffect(() => {
    let active = true;
    apiGet<{ unit: ResearchUnitCost | null }>(
      `/workspaces/${workspaceId}/settings/research-estimate`,
    )
      .then((result) => active && setUnit(result.unit))
      .catch(() => active && setUnit(null));
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // The page may reload its values after a save; follow them unless the person is mid-choice.
  const valueKey = JSON.stringify(values);
  useEffect(() => {
    const now = presetOf(values);
    setChosen(now === 'custom' ? null : now);
    setSecond({
      connection: text(values['research.dual_connection_id']),
      model: text(values['research.dual_model']),
    });
  }, [valueKey]);

  const needsSecond = chosen === 'sensitive';
  const secondReady = second.connection !== '' && second.model !== '';
  const minutes = (seconds: number) => formatNumber(locale, Math.max(1, Math.round(seconds / 60)));

  const changesFor = (preset: ResearchPresetId) => {
    const changes: Record<string, boolean | number | string | null> = {
      ...RESEARCH_PRESETS[preset],
    };
    if (preset === 'sensitive') {
      changes['research.dual_connection_id'] = second.connection;
      changes['research.dual_model'] = second.model;
    }
    return changes;
  };

  const apply = (preset: ResearchPresetId) => {
    const changes = changesFor(preset);
    const name = t.names[preset] ?? preset;
    if (target.kind === 'draft') {
      target.onChoose(changes);
      return Promise.resolve();
    }
    return action.run(
      async () => {
        await apiSend('PUT', `/workspaces/${workspaceId}/settings/assignments/batch`, {
          scopeType: target.scopeType,
          scopeId: target.scopeId,
          items: Object.entries(changes).map(([key, value]) => ({ key, value })),
          reason: fill(t.reason, { name }),
        });
        target.onSaved();
      },
      fill(t.applied, { name }),
    );
  };

  const dualOn = values['research.dual_enabled'] === true;
  return (
    <fieldset className="preset-picker stack" disabled={disabled} aria-describedby={`${id}-help`}>
      <legend>{t.title}</legend>
      <p id={`${id}-help`} className="muted">
        {t.help}
      </p>
      <Notice notice={action.notice} />
      <div className="preset-grid" role="radiogroup" aria-label={t.title}>
        {RESEARCH_PRESET_IDS.map((preset) => {
          const estimate = estimateResearch(researchValuesOf(RESEARCH_PRESETS[preset]), unit);
          const selected = chosen === preset;
          return (
            <label
              key={preset}
              className={`preset-card${selected ? ' preset-selected' : ''}`}
              htmlFor={`${id}-${preset}`}
            >
              <input
                type="radio"
                name={`${id}-preset`}
                id={`${id}-${preset}`}
                checked={selected}
                onChange={() => setChosen(preset)}
              />
              <strong dir={textDir(locale)}>
                {t.names[preset]}
                {current === preset && <span className="badge tone-ok"> {t.current}</span>}
              </strong>
              <span dir={textDir(locale)}>{t.blurbs[preset]}</span>
              <small className="muted">{factorLine(t, locale, estimate.factor)}</small>
              {estimate.usd && estimate.seconds && (
                <small className="muted">
                  {fill(t.cost, {
                    low: formatUsd(locale, estimate.usd.low),
                    high: formatUsd(locale, estimate.usd.high),
                  })}
                  {' — '}
                  {fill(t.time, {
                    low: minutes(estimate.seconds.low),
                    high: minutes(estimate.seconds.high),
                  })}
                </small>
              )}
            </label>
          );
        })}
      </div>
      {unit === null && <p className="muted">{t.noHistory}</p>}
      {current === 'custom' && <p className="notice">{t.custom}</p>}
      {needsSecond && (
        <div className="stack">
          <p>{t.needSecond}</p>
          <ModelPicker
            locale={locale}
            workspaceId={workspaceId}
            connectionId={second.connection}
            model={second.model}
            idPrefix={`${id}-second`}
            onChange={(connection, model) => setSecond({ connection, model })}
          />
          {!secondReady && <p className="notice error">{t.pickSecondFirst}</p>}
        </div>
      )}
      <div>
        <button
          type="button"
          className="primary-button"
          disabled={
            disabled ||
            chosen === null ||
            action.busy ||
            (needsSecond && !secondReady) ||
            (target.kind === 'save' && chosen === current && !needsSecond)
          }
          onClick={() => chosen && void apply(chosen)}
        >
          {action.busy ? t.applying : t.apply}
        </button>
      </div>
      {dualOn && (
        <div className="notice" role="note">
          <p>{t.dualOn}</p>
          {target.kind === 'save' && (
            <button
              type="button"
              className="link-like"
              disabled={disabled || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await apiSend('PUT', `/workspaces/${workspaceId}/settings/assignments/batch`, {
                    scopeType: target.scopeType,
                    scopeId: target.scopeId,
                    items: [{ key: 'research.dual_enabled', value: false }],
                    reason: t.dualOff,
                  });
                  target.onSaved();
                }, t.dualOffDone)
              }
            >
              {t.dualOff}
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
