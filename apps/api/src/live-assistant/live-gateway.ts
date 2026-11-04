import {
  accessRulesFromSettings,
  confirmStrictnessLevels,
  decideCapability,
  liveAssistantCapsSchema,
  liveAssistantDefaults,
  liveAssistantLimits,
  liveAssistantLanguages,
  liveAssistantListeningModes,
  liveAssistantModes,
  liveAssistantSettingDefaults,
  matchTargetEcho,
  readSpokenAnswer,
  t3Categories,
  type AssistantAccessRule,
  type ConfirmStrictness,
  type LiveActionStatus,
  type LiveAssistantCaps,
  type LiveConfirmationVia,
  type LiveNextStep,
  type LiveRefusalReason,
  type RiskTier,
  type T3Category,
} from '@docoo/contracts';

import type { LiveCapabilityRegistry, LiveLocale, LivePreview } from './capabilities.js';

/**
 * The decisions of the gateway, free of the database and of any provider (ADR-0055 §4-3): what the
 * owner's settings mean right now, whether a proposed change may exist, and whether what a person
 * said or clicked counts as a confirmation. The service only stores what these functions decide.
 */

export interface LiveSettings {
  readonly enabled: boolean;
  readonly disclosureAccepted: boolean;
  readonly displayName: string;
  readonly spokenName: string;
  readonly wakeEnabled: boolean;
  readonly wakePhrase: string;
  readonly mode: (typeof liveAssistantModes)[number];
  readonly connectionId: string;
  readonly model: string;
  readonly language: (typeof liveAssistantLanguages)[number];
  readonly listeningMode: (typeof liveAssistantListeningModes)[number];
  readonly caps: LiveAssistantCaps;
  readonly strictness: ConfirmStrictness;
  readonly enabledT3: readonly T3Category[];
  readonly rules: readonly AssistantAccessRule[];
  readonly storeTranscripts: boolean;
  readonly transcriptRetentionDays: number;
}

/**
 * Reads the assistant's settings. A value that is missing takes its default; one that no longer
 * makes sense takes the default too, which is the narrow and quiet choice (off, read only, small
 * caps), never a wider one. The access rule is built by the same function the settings page uses.
 */
export function liveSettingsFrom(values: Record<string, unknown>): LiveSettings {
  const defaults = liveAssistantSettingDefaults;
  const raw = (key: keyof typeof defaults): unknown => values[key] ?? defaults[key];
  const text = (key: keyof typeof defaults, max = 300): string => {
    const value = raw(key);
    return typeof value === 'string' && value.length <= max ? value : String(defaults[key]);
  };
  const flag = (key: keyof typeof defaults): boolean => raw(key) === true;
  const oneOf = <T extends string>(key: keyof typeof defaults, allowed: readonly T[]): T => {
    const value = raw(key);
    const found = allowed.find((item) => item === value);
    return found ?? (defaults[key] as unknown as T);
  };
  const number = (key: keyof typeof defaults, fallback: number): number => {
    const value = raw(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const capCandidate = {
    idleSleepS: number('live_assistant.idle_sleep_s', liveAssistantDefaults.idleSleepS),
    sessionMaxMinutes: number(
      'live_assistant.session_max_minutes',
      liveAssistantDefaults.sessionMaxMinutes,
    ),
    sessionCostCapUsd: number(
      'live_assistant.session_cost_cap_usd',
      liveAssistantDefaults.sessionCostCapUsd,
    ),
    dailyCostCapUsd: number(
      'live_assistant.daily_cost_cap_usd',
      liveAssistantDefaults.dailyCostCapUsd,
    ),
    taskCostCapUsd: number(
      'live_assistant.task_cost_cap_usd',
      liveAssistantDefaults.taskCostCapUsd,
    ),
    maxActionsPerTask: number(
      'live_assistant.max_actions_per_task',
      liveAssistantDefaults.maxActionsPerTask,
    ),
    confirmTimeoutS: number(
      'live_assistant.confirm_timeout_s',
      liveAssistantDefaults.confirmTimeoutS,
    ),
  };
  const caps = liveAssistantCapsSchema.safeParse(capCandidate);
  const t3 = raw('live_assistant.t3_categories');
  return {
    enabled: flag('live_assistant.enabled'),
    disclosureAccepted: flag('live_assistant.disclosure_accepted'),
    displayName: text('live_assistant.display_name', 40) || defaults['live_assistant.display_name'],
    spokenName: text('live_assistant.spoken_name', 40) || defaults['live_assistant.spoken_name'],
    wakeEnabled: flag('live_assistant.wake_enabled'),
    wakePhrase: text('live_assistant.wake_phrase', 60) || defaults['live_assistant.wake_phrase'],
    mode: oneOf('live_assistant.mode', liveAssistantModes),
    connectionId: text('live_assistant.connection_id', 36),
    model: text('live_assistant.model', 200),
    language: oneOf('live_assistant.language', liveAssistantLanguages),
    listeningMode: oneOf('live_assistant.listening_mode', liveAssistantListeningModes),
    caps: caps.success
      ? caps.data
      : liveAssistantCapsSchema.parse({
          idleSleepS: liveAssistantDefaults.idleSleepS,
          sessionMaxMinutes: liveAssistantDefaults.sessionMaxMinutes,
          sessionCostCapUsd: liveAssistantDefaults.sessionCostCapUsd,
          dailyCostCapUsd: liveAssistantDefaults.dailyCostCapUsd,
          taskCostCapUsd: liveAssistantDefaults.taskCostCapUsd,
          maxActionsPerTask: liveAssistantDefaults.maxActionsPerTask,
          confirmTimeoutS: liveAssistantDefaults.confirmTimeoutS,
        }),
    strictness: oneOf('live_assistant.confirm_strictness', confirmStrictnessLevels),
    enabledT3: Array.isArray(t3) ? t3Categories.filter((category) => t3.includes(category)) : [],
    rules: accessRulesFromSettings(values),
    storeTranscripts: flag('live_assistant.store_transcripts'),
    transcriptRetentionDays: ((): number => {
      const days = number(
        'live_assistant.transcript_retention_days',
        liveAssistantDefaults.transcriptRetentionDays,
      );
      const { min, max } = liveAssistantLimits.transcriptRetentionDays;
      // Out of range falls back to the default, which keeps text longer than a silly small value would.
      return Number.isInteger(days) && days >= min && days <= max
        ? days
        : liveAssistantDefaults.transcriptRetentionDays;
    })(),
  };
}

/** The language the assistant speaks to the owner; `auto` follows the interface, which is Persian first. */
export function localeOf(language: LiveSettings['language']): LiveLocale {
  return language === 'en' ? 'en' : 'fa';
}

/** Why a session may not start or go on, from the settings alone. Null means it may. */
export function startBlocker(
  settings: LiveSettings,
): 'disabled' | 'disclosure' | 'not_configured' | null {
  if (!settings.enabled) return 'disabled';
  if (!settings.disclosureAccepted) return 'disclosure';
  if (
    settings.mode === 'realtime' &&
    (settings.connectionId === '' || settings.model.trim() === '')
  ) {
    return 'not_configured';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Proposing a change
// ---------------------------------------------------------------------------------------------

export type ProposalDecision =
  | { readonly outcome: 'refused'; readonly reason: LiveRefusalReason }
  | {
      readonly outcome: 'accepted';
      readonly tier: RiskTier;
      readonly steps: readonly string[];
      readonly projectId: string | null;
      readonly params: unknown;
      readonly preview: LivePreview;
    };

export interface ProposalInput {
  readonly registry: LiveCapabilityRegistry;
  readonly capability: string;
  readonly params: unknown;
  readonly settings: LiveSettings;
  readonly tainted: boolean;
  readonly currentProjectId: string | null;
  /** What the capability's `prepare` found, when it ran. */
  readonly facts?: unknown;
  /** `prepare` ran and failed: the target is not there. Said only once access is allowed. */
  readonly prepareFailed?: boolean | undefined;
  /** Asking again at confirmation: the preview was fixed when proposed and is not rebuilt. */
  readonly skipPreview?: boolean | undefined;
}

/**
 * May this change exist at all, and with which confirmations? The model chose the name and the
 * parameters; everything else comes from the registry and the owner's settings. Anything odd is a
 * refusal, never a guess.
 */
export function decideProposal(input: ProposalInput): ProposalDecision {
  const capability = input.registry.get(input.capability);
  if (!capability) return { outcome: 'refused', reason: 'unknown_capability' };
  const parsed = capability.params.safeParse(input.params);
  if (!parsed.success) return { outcome: 'refused', reason: 'invalid_params' };
  const projectId =
    capability.meta.area === 'project' ? (capability.projectOf?.(parsed.data) ?? null) : null;
  const decision = decideCapability({
    capability: capability.meta,
    rules: input.settings.rules,
    projectId,
    currentProjectId: input.currentProjectId,
    tainted: input.tainted,
    strictness: input.settings.strictness,
    enabledT3: input.settings.enabledT3,
  });
  if (!decision.allowed) return { outcome: 'refused', reason: decision.reason };
  if (input.prepareFailed) return { outcome: 'refused', reason: 'target_not_found' };
  if (input.skipPreview) {
    return {
      outcome: 'accepted',
      tier: decision.plan.tier,
      steps: decision.plan.steps,
      projectId,
      params: parsed.data,
      preview: { summary: '' },
    };
  }
  let preview: LivePreview;
  try {
    preview = capability.describe(parsed.data, localeOf(input.settings.language), input.facts);
  } catch {
    return { outcome: 'refused', reason: 'misconfigured' };
  }
  if (preview.summary.trim() === '' || preview.summary.length > 2000) {
    return { outcome: 'refused', reason: 'misconfigured' };
  }
  if (decision.plan.tier === 'T3' && !preview.targetName?.trim()) {
    return { outcome: 'refused', reason: 'misconfigured' };
  }
  return {
    outcome: 'accepted',
    tier: decision.plan.tier,
    steps: decision.plan.steps,
    projectId,
    params: parsed.data,
    preview: {
      summary: preview.summary.trim(),
      ...(preview.targetName?.trim()
        ? { targetName: preview.targetName.trim().slice(0, 300) }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Confirming it
// ---------------------------------------------------------------------------------------------

/** The second confirmation of an irreversible change cannot come in the same breath as the first. */
export const MIN_SECOND_CONFIRMATION_MS = 1500;

export type ConfirmationJudgment =
  | { readonly outcome: 'advance'; readonly via: LiveConfirmationVia }
  | { readonly outcome: 'decline' }
  | {
      readonly outcome: 'retry';
      readonly reason: 'unclear' | 'echo_mismatch' | 'too_soon' | 'not_open';
    };

export interface ConfirmationInput {
  readonly status: LiveActionStatus;
  readonly tier: RiskTier | null;
  readonly targetName: string | null;
  readonly via: LiveConfirmationVia;
  readonly transcript?: string | undefined;
  readonly firstConfirmedAtMs?: number | undefined;
  readonly nowMs: number;
}

/**
 * Does what the person said or clicked count? A click always does. A spoken answer is read by
 * rule (`readSpokenAnswer`), not by a model: an unclear answer asks again, a clear no declines.
 * The second step of an irreversible change needs the name of the thing itself (or a click).
 */
export function judgeConfirmation(input: ConfirmationInput): ConfirmationJudgment {
  if (input.status !== 'proposed' && input.status !== 'first_confirmed') {
    return { outcome: 'retry', reason: 'not_open' };
  }
  const second = input.status === 'first_confirmed';
  if (
    second &&
    input.firstConfirmedAtMs !== undefined &&
    input.nowMs - input.firstConfirmedAtMs < MIN_SECOND_CONFIRMATION_MS
  ) {
    return { outcome: 'retry', reason: 'too_soon' };
  }
  if (input.via === 'click') return { outcome: 'advance', via: 'click' };
  const transcript = input.transcript ?? '';
  if (transcript.trim() === '') return { outcome: 'retry', reason: 'unclear' };
  if (readSpokenAnswer(transcript) === 'reject') return { outcome: 'decline' };
  if (second) {
    if (input.targetName !== null && matchTargetEcho(transcript, input.targetName)) {
      return { outcome: 'advance', via: 'voice' };
    }
    return { outcome: 'retry', reason: 'echo_mismatch' };
  }
  return readSpokenAnswer(transcript) === 'confirm'
    ? { outcome: 'advance', via: 'voice' }
    : { outcome: 'retry', reason: 'unclear' };
}

/** What the next confirmation of a change must be, for the screen and the voice prompt. */
export function nextStepOf(status: LiveActionStatus): LiveNextStep {
  if (status === 'proposed') return 'confirm';
  if (status === 'first_confirmed') return 'echo';
  return null;
}
