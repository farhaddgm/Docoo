import { z } from 'zod';

import {
  assistantAccessRuleSchema,
  liveAssistantCapsSchema,
  liveAssistantLanguages,
  liveAssistantListeningModes,
  liveAssistantModes,
  liveActionStatuses,
  riskTiers,
  type CapKind,
} from './live-assistant.js';

/**
 * The HTTP shape of the live voice assistant (ADR-0055): sessions, their transcript and the
 * gateway through which every change is proposed and confirmed. The API answers with these views
 * and the web page reads them; neither names the assistant.
 */

export const liveSessionEndReasons = [
  'user',
  'idle',
  'cap_cost',
  'cap_time',
  'cap_daily',
  'disabled',
  'superseded',
  'error',
] as const;
export type LiveSessionEndReason = (typeof liveSessionEndReasons)[number];

/** What the browser may give as the reason for ending; the server picks the others itself. */
export const clientEndReasons = ['user', 'idle', 'error'] as const;

export const liveConfirmationVias = ['voice', 'click'] as const;
export type LiveConfirmationVia = (typeof liveConfirmationVias)[number];

/** Why the gateway said no. Stored with the refused row and shown to the owner. */
export const liveRefusalReasons = [
  'unknown_capability',
  'forbidden',
  'out_of_scope',
  'read_only',
  'project_required',
  't3_disabled',
  'misconfigured',
  'invalid_params',
  /** The thing it asked about does not exist (or no longer does). Said only after access is allowed. */
  'target_not_found',
  'cap_exceeded',
  'assistant_disabled',
] as const;
export type LiveRefusalReason = (typeof liveRefusalReasons)[number];

/** Why a proposed change was cancelled rather than run. */
export const liveCancelReasons = [
  'declined',
  'cancelled_by_user',
  'policy_changed',
  'session_ended',
] as const;
export type LiveCancelReason = (typeof liveCancelReasons)[number];

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const uuid = z.uuid().transform((value) => value.toLowerCase());

/** A session with a voice, or one the owner types into (the server-side executor alone). */
export const liveChannels = ['voice', 'text'] as const;
export type LiveChannel = (typeof liveChannels)[number];

export const liveSessionModes = [...liveAssistantModes, 'text'] as const;

export const startLiveSessionSchema = z.strictObject({
  channel: z.enum(liveChannels).default('voice'),
  /** The project the owner has open right now, if any (counts for "the open project" access). */
  currentProjectId: uuid.optional(),
});

/** Totals so far, not increments: a repeated report changes nothing. */
export const reportLiveUsageSchema = z.strictObject({
  inputTokens: z.number().int().min(0).max(1_000_000_000),
  outputTokens: z.number().int().min(0).max(1_000_000_000),
  costUsd: z.number().min(0).max(10_000),
});

export const endLiveSessionSchema = z.strictObject({
  reason: z.enum(clientEndReasons).default('user'),
});

export const appendLiveMessagesSchema = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
});

export const proposeLiveActionSchema = z.strictObject({
  sessionId: uuid,
  capability: z.string().trim().min(1).max(100),
  params: z.record(z.string(), z.unknown()).default({}),
  /**
   * True when untrusted content (a stage output, knowledge, the web) was read in the same turn.
   * It can only raise how strictly a change is confirmed, never lower it.
   */
  tainted: z.boolean().default(false),
  currentProjectId: uuid.optional(),
});

export const confirmLiveActionSchema = z
  .strictObject({
    via: z.enum(liveConfirmationVias),
    /** What the person said, from the speech recognizer. Required for `voice`. */
    transcript: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => value.via !== 'voice' || value.transcript !== undefined, {
    message: 'A spoken confirmation carries what was said.',
    path: ['transcript'],
  });

export type StartLiveSession = z.infer<typeof startLiveSessionSchema>;
export type ReportLiveUsage = z.infer<typeof reportLiveUsageSchema>;
export type ProposeLiveAction = z.infer<typeof proposeLiveActionSchema>;
export type ConfirmLiveAction = z.infer<typeof confirmLiveActionSchema>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const liveAssistantUnavailableReasons = [
  'disabled',
  'disclosure',
  'not_configured',
] as const;
export type LiveAssistantUnavailableReason = (typeof liveAssistantUnavailableReasons)[number];

/** Why typing to the assistant is not possible yet: the executor's connection and model. */
export const liveTextUnavailableReasons = [
  'disabled',
  'disclosure',
  'executor_not_configured',
] as const;
export type LiveTextUnavailableReason = (typeof liveTextUnavailableReasons)[number];

export const liveAssistantClientConfigSchema = z.object({
  enabled: z.boolean(),
  /** Settings are complete: switched on, privacy notice accepted, a model chosen. */
  ready: z.boolean(),
  unavailableReason: z.enum(liveAssistantUnavailableReasons).nullable(),
  /** The same for typing: settings complete with an executor connection and model. */
  textReady: z.boolean(),
  /** Which pair of connection and model typing uses: the assistant's own, or the workspace's AI pair. */
  executorSource: z.enum(['own', 'workspace']),
  textUnavailableReason: z.enum(liveTextUnavailableReasons).nullable(),
  /**
   * Whether a speech provider is connected to the server yet. False until the provider step of
   * ADR-0055 ships, so the web keeps the activation button disabled even when `ready` is true.
   */
  providerConnected: z.boolean(),
  displayName: z.string(),
  spokenName: z.string(),
  wakeEnabled: z.boolean(),
  wakePhrase: z.string(),
  language: z.enum(liveAssistantLanguages),
  mode: z.enum(liveAssistantModes),
  listeningMode: z.enum(liveAssistantListeningModes),
  caps: liveAssistantCapsSchema,
  accessRules: z.array(assistantAccessRuleSchema),
  activeSessionId: z.uuid().nullable(),
});
export type LiveAssistantClientConfig = z.infer<typeof liveAssistantClientConfigSchema>;

export const liveSessionViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(['active', 'ended']),
  endReason: z.enum(liveSessionEndReasons).nullable(),
  mode: z.enum(liveSessionModes),
  model: z.string(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  endedAt: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  /** Minutes since the session began, by the server's clock (or until it ended). */
  minutes: z.number(),
  messageCount: z.number().int(),
  caps: liveAssistantCapsSchema,
});
export type LiveSessionView = z.infer<typeof liveSessionViewSchema>;

export const liveMessageViewSchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
});
export type LiveMessageView = z.infer<typeof liveMessageViewSchema>;

/** What the next confirmation of a change must be: a plain yes, or the irreversible target's name. */
export type LiveNextStep = 'confirm' | 'echo' | null;

export const liveActionViewSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  capability: z.string(),
  projectId: z.uuid().nullable(),
  tier: z.enum(riskTiers).nullable(),
  steps: z.array(z.string()),
  status: z.enum(liveActionStatuses),
  summary: z.string(),
  targetName: z.string().nullable(),
  refusalReason: z.enum(liveRefusalReasons).nullable(),
  cancelReason: z.enum(liveCancelReasons).nullable(),
  result: z.unknown().nullable(),
  errorCode: z.string().nullable(),
  proposedAt: z.string(),
  expiresAt: z.string(),
  firstConfirmedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  nextStep: z.enum(['confirm', 'echo']).nullable(),
});
export type LiveActionView = z.infer<typeof liveActionViewSchema>;

export const liveUsageAnswerSchema = z.object({
  session: liveSessionViewSchema,
  /** `ok`, or the caps close to (`warn`) or past (`exceeded`) their limit; exceeded ends the session. */
  capStatus: z.enum(['ok', 'warn', 'exceeded']),
  capsReached: z.array(z.custom<CapKind>()),
});
export type LiveUsageAnswer = z.infer<typeof liveUsageAnswerSchema>;

// ---------------------------------------------------------------------------------------------
// What it cost
// ---------------------------------------------------------------------------------------------

const costPeriod = z.object({
  /** Dollars, from the prices on record; a model with no price counts as zero here. */
  costUsd: z.number(),
  /** The part of it that typed requests (the executor) used. */
  typedCostUsd: z.number(),
  tokens: z.number(),
  sessions: z.number().int(),
});

export const liveCostSummarySchema = z.object({
  /** The last 24 hours: the period the daily cap is measured over. */
  day: costPeriod,
  week: costPeriod,
  month: costPeriod,
  dailyCapUsd: z.number(),
});
export type LiveCostSummary = z.infer<typeof liveCostSummarySchema>;

// ---------------------------------------------------------------------------------------------
// Asking the executor (typing to the assistant)
// ---------------------------------------------------------------------------------------------

export const askLiveAssistantSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  /** The last turns of the conversation, for the model to follow; the server keeps none for it. */
  context: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .max(10)
    .default([]),
  /** The project the owner has open right now, if any. */
  currentProjectId: uuid.optional(),
});
export type AskLiveAssistant = z.infer<typeof askLiveAssistantSchema>;

/** Why the executor stopped: it answered, or one of the limits of a single request was reached. */
export const liveAskStops = ['answered', 'tool_limit', 'round_limit', 'cost_cap', 'error'] as const;
export type LiveAskStop = (typeof liveAskStops)[number];

export const liveAskAnswerSchema = z.object({
  answer: z.string(),
  /** The changes proposed while answering; each waits for a person to confirm it. */
  actions: z.array(liveActionViewSchema),
  toolCalls: z.number().int(),
  stop: z.enum(liveAskStops),
  /** When a model call failed: its kind (never a message), so the screen can say what to check. */
  errorCode: z.string().nullable(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    /** Null when the model has no price on record: the cost is unknown, never shown as zero. */
    costUsd: z.number().nullable(),
  }),
});
export type LiveAskAnswer = z.infer<typeof liveAskAnswerSchema>;
