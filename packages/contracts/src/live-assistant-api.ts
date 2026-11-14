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
/** What the assistant is doing right now, as the browser last knew (ADR-0056 follow-ups). */
export const liveActivities = ['listening', 'thinking', 'speaking', 'asleep'] as const;
export type LiveActivity = (typeof liveActivities)[number];

export const reportLiveUsageSchema = z.strictObject({
  inputTokens: z.number().int().min(0).max(1_000_000_000),
  outputTokens: z.number().int().min(0).max(1_000_000_000),
  /** Input tokens the provider read from its cache; part of the input, not an addition to it. */
  cachedInputTokens: z.number().int().min(0).max(1_000_000_000).default(0),
  costUsd: z.number().min(0).max(10_000),
  /** What the assistant is doing now; absent when the browser does not know. */
  activity: z.enum(liveActivities).optional(),
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
/** What a caller may send: the cache count and the activity can be left out. */
export type ReportLiveUsageInput = z.input<typeof reportLiveUsageSchema>;
export type ProposeLiveAction = z.infer<typeof proposeLiveActionSchema>;
export type ConfirmLiveAction = z.infer<typeof confirmLiveActionSchema>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const liveAssistantUnavailableReasons = [
  'disabled',
  'disclosure',
  'not_configured',
  /** The chosen connection is a brand that carries no live voice (yet). */
  'provider_unsupported',
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
  /** The brand of the chosen voice connection (it decides the kind of session), or null when none. */
  voiceProvider: z.enum(['openai', 'elevenlabs']).nullable(),
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
// What the assistant shows on the screen
// ---------------------------------------------------------------------------------------------

/**
 * Pages the assistant may open for the owner. A name, never an address: the browser maps each to
 * its own route, so a model cannot send the owner anywhere else.
 */
export const liveScreenPages = [
  'projects',
  'new_project',
  'project',
  'knowledge',
  'notifications',
  'costs',
  'providers',
  'topics',
  'explorations',
  'agents',
  'brain',
  'businesses',
  'templates',
] as const;
export type LiveScreenPage = (typeof liveScreenPages)[number];

/** The sections of one project's page (`?tab=`). */
export const liveProjectTabs = [
  'overview',
  'business',
  'knowledge',
  'agents',
  'settings',
  'workflow',
  'requirements',
  'timeline',
  'problem',
  'research',
  'solutions',
  'documents',
  'evaluation',
] as const;
export type LiveProjectTab = (typeof liveProjectTabs)[number];

/**
 * What goes into the new-project form as a draft. The owner reads it and presses "Create"
 * themselves: nothing here saves, and nothing here touches the model, the connection or any other
 * setting of the project. Limits are the form's own (the API allows more; a model need not write it).
 */
export const liveNewProjectFillFields = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  initialProblem: z.string().trim().min(1).max(4000).optional(),
  expectedOutput: z.string().trim().max(2000).optional(),
  code: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)
    .optional(),
  outputLanguage: z.enum(['fa', 'en']).optional(),
});
/** At least one value must be given. */
export const hasFillValue = (values: Record<string, unknown>): boolean =>
  Object.values(values).some((value) => value !== undefined);
export const liveNewProjectFillSchema = liveNewProjectFillFields.refine(hasFillValue, {
  message: 'Give at least one value.',
});
export type LiveNewProjectFill = z.infer<typeof liveNewProjectFillSchema>;

/** An instruction for the browser, from a screen capability's result. It changes no data. */
export const liveScreenInstructionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('open'),
    page: z.enum(liveScreenPages),
    projectId: uuid.optional(),
    tab: z.enum(liveProjectTabs).optional(),
  }),
  z.strictObject({
    type: z.literal('fill'),
    form: z.literal('new_project'),
    values: liveNewProjectFillSchema,
  }),
]);
export type LiveScreenInstruction = z.infer<typeof liveScreenInstructionSchema>;

/** One step the executor took for a typed request, for the list under its answer. */
export const liveAskStepSchema = z.object({
  capability: z.string(),
  summary: z.string(),
  status: z.enum(['done', 'waiting', 'refused', 'failed']),
});
export type LiveAskStep = z.infer<typeof liveAskStepSchema>;

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

/** The breakdown behind the cost tab: what the person's own conversations cost over some days. */
export const LIVE_COST_REPORT_DAYS = [7, 30, 90] as const;

export const liveCostReportSchema = z.object({
  days: z.number().int(),
  /** One row per provider, kind of session and model; "text" sessions have no voice provider. */
  groups: z.array(
    z.object({
      provider: z.string(),
      mode: z.enum(['realtime', 'pipeline', 'text']),
      model: z.string(),
      sessions: z.number().int(),
      /** Wall-clock minutes from start to end, sleeping time included (a sleeping link costs nothing). */
      minutes: z.number(),
      voiceCostUsd: z.number(),
      typedCostUsd: z.number(),
      tokens: z.number(),
      cachedInputTokens: z.number(),
    }),
  ),
  /** One row per day (UTC) with any session, oldest first. */
  byDay: z.array(
    z.object({
      day: z.string(),
      sessions: z.number().int(),
      voiceCostUsd: z.number(),
      typedCostUsd: z.number(),
    }),
  ),
  dailyCapUsd: z.number(),
});
export type LiveCostReport = z.infer<typeof liveCostReportSchema>;

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
  /** What to show on the screen (open a page, put a draft into a form); changes no data. */
  screen: z.array(liveScreenInstructionSchema),
  /** What the executor did, step by step, for the owner to read. */
  steps: z.array(liveAskStepSchema),
  toolCalls: z.number().int(),
  stop: z.enum(liveAskStops),
  /** When a model call failed: its kind (never a message), so the screen can say what to check. */
  errorCode: z.string().nullable(),
  /** The provider's own reason (sanitised, at most 300 characters), for the owner to read. */
  errorDetail: z.string().max(300).nullable().optional(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    /** Null when the model has no price on record: the cost is unknown, never shown as zero. */
    costUsd: z.number().nullable(),
  }),
});
export type LiveAskAnswer = z.infer<typeof liveAskAnswerSchema>;

/**
 * The check of the text model that answers typed requests and does the assistant's work (the
 * executor): one small real call with the same tools it is given in a conversation. `failure` is
 * a kind; `detail` is the provider's own short reason (sanitised), so "it did not work" can be
 * traced without server logs.
 */
export const liveExecutorCheckFailures = [
  'not_configured',
  'connection_unavailable',
  'auth',
  'rate_limited',
  'timeout',
  'invalid_request',
  'transient',
  'empty_answer',
  'output_limit',
  'unexpected',
] as const;
export type LiveExecutorCheckFailure = (typeof liveExecutorCheckFailures)[number];

export const liveExecutorCheckSchema = z.object({
  ok: z.boolean(),
  failure: z.enum(liveExecutorCheckFailures).nullable(),
  /** The provider's reason, when it gave one (at most 300 characters). */
  detail: z.string().max(300).nullable(),
  /** The code the platform recorded for the failure, e.g. `openai_invalid_request`. */
  code: z.string().max(100).nullable(),
  model: z.string(),
  /** How many tools the model was offered, as in a conversation. */
  toolCount: z.number().int(),
  latencyMs: z.number().int().nullable(),
});
export type LiveExecutorCheck = z.infer<typeof liveExecutorCheckSchema>;

/**
 * Why a check of the voice link failed, as a kind and never the provider's message: the screen says
 * what to do for each. `region` is the provider refusing the country the server runs in.
 */
export const liveVoiceCheckFailures = [
  'not_configured',
  'connection_unavailable',
  'not_openai',
  'auth',
  'region',
  'model',
  'network',
  'timeout',
  /** The provider's usage quota or rate limit is reached. */
  'quota',
  /** The provider's terms were not accepted in its dashboard. */
  'terms',
  'unexpected',
] as const;
export type LiveVoiceCheckFailure = (typeof liveVoiceCheckFailures)[number];

export const liveVoiceCheckSchema = z.object({
  ok: z.boolean(),
  failure: z.enum(liveVoiceCheckFailures).nullable(),
  /** The model the check asked for. */
  model: z.string(),
  /** The kinds of the first events the provider sent (no content), for support. */
  events: z.array(z.string().max(100)).max(10),
  latencyMs: z.number().int().nullable(),
});
export type LiveVoiceCheck = z.infer<typeof liveVoiceCheckSchema>;
