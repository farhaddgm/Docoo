import type { MonitorSettingKey, MonitorSettingValue } from './monitor.js';
import { redactText } from './redaction.js';

/**
 * What the viewer monitor shows (ADR-0056 §7, §8-3): the steps of one project the owner put on the
 * screen, for the people in the room. Like the voice monitor, one pure function builds the view
 * field by field from the settings; what a setting hides is `null`, and texts that come from the
 * work are masked on the way.
 */

// ---- what goes in ---------------------------------------------------------------------------

export interface ViewerSourceStage {
  readonly stage: string;
  readonly status: string;
  readonly attempts: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** The text of the latest output, as the database holds it (already turned into plain text). */
  readonly outputTitle: string | null;
  readonly outputText: string | null;
  readonly outputAt: string | null;
  readonly errorCode: string | null;
  readonly errorText: string | null;
}

export interface ViewerSourceGate {
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface ViewerSourceDocument {
  readonly title: string;
  readonly status: string;
  readonly preview: string | null;
  readonly updatedAt: string;
  /** The latest quality evaluation of the document, if it has been evaluated. */
  readonly quality: { readonly status: string; readonly overall: number } | null;
}

export interface ViewerSourceResearch {
  readonly title: string | null;
  /** The address of a web page; null for a source from the organization's own knowledge. */
  readonly url: string | null;
  readonly verified: boolean;
}

export interface ViewerSourceAgent {
  readonly role: string;
  readonly calls: number;
  readonly lastTool: string | null;
  readonly lastDecision: string | null;
  readonly lastAt: string | null;
}

export interface ViewerSourceAction {
  readonly status: string;
  readonly summary: string;
  readonly targetName: string | null;
  readonly proposedAt: string;
}

export interface ViewerSourceUsage {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface ViewerMonitorSource {
  readonly nowMs: number;
  readonly project: {
    readonly code: string;
    readonly title: string;
    readonly status: string;
    readonly currentStage: string;
  } | null;
  readonly stages: readonly ViewerSourceStage[];
  readonly gates: readonly ViewerSourceGate[];
  readonly documents: readonly ViewerSourceDocument[];
  readonly agents: readonly ViewerSourceAgent[];
  readonly actions: readonly ViewerSourceAction[];
  readonly assistantLive: boolean;
  readonly usage: readonly ViewerSourceUsage[];
  /** The sources the research stage cited. */
  readonly research: readonly ViewerSourceResearch[];
  readonly topics: readonly string[];
  readonly businessName: string | null;
  readonly person: { readonly firstName: string; readonly fullName: string };
  /** The lines of the voice conversation that is running now, oldest first. */
  readonly transcript: readonly {
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly createdAt: string;
  }[];
}

// ---- what comes out -------------------------------------------------------------------------

export interface ViewerMonitorStage {
  readonly stage: string;
  readonly status: string;
  readonly current: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly attempts: number | null;
  readonly output: null | { readonly title: string | null; readonly text: string | null };
  readonly error: null | { readonly message: string | null };
}

export interface ViewerMonitorView {
  readonly generatedAt: string;
  readonly delayS: number;
  /** Null until the owner puts a project on the screen. */
  readonly project: null | {
    readonly name: string | null;
    readonly code: string | null;
    readonly status: string;
    readonly currentStage: string;
    readonly topics: readonly string[] | null;
    readonly business: string | null;
  };
  /** Who spoke in the assistant conversation, as far as the setting says. */
  readonly person: null | { readonly role: 'owner'; readonly name: string | null };
  readonly transcript:
    | null
    | readonly {
        readonly role: 'user' | 'assistant';
        readonly text: string;
        readonly at: string;
      }[];
  readonly stages: readonly ViewerMonitorStage[];
  readonly gates: null | readonly { readonly title: string; readonly status: string }[];
  readonly documents:
    | null
    | readonly {
        readonly title: string;
        readonly status: string;
        readonly preview: string | null;
        readonly quality: null | { readonly passed: boolean; readonly score: number | null };
      }[];
  readonly research: null | {
    readonly count: number;
    readonly verified: number;
    readonly internal: number;
    readonly domains: readonly string[] | null;
    readonly sources:
      | readonly {
          readonly title: string | null;
          readonly url: string | null;
          readonly verified: boolean;
        }[]
      | null;
  };
  readonly agents:
    | null
    | readonly {
        readonly role: string;
        readonly calls: number;
        readonly last: null | { readonly tool: string; readonly decision: string | null };
      }[];
  readonly assistant: null | {
    readonly live: boolean;
    readonly steps:
      | null
      | readonly {
          readonly status: string;
          readonly summary: string;
          readonly target: string | null;
        }[];
  };
  readonly usage: null | {
    readonly models: readonly {
      readonly provider: string;
      readonly model: string | null;
      readonly tokens: number;
      readonly input: number | null;
      readonly output: number | null;
    }[];
    readonly tokensTotal: number | null;
    readonly costUsd: number | null;
    readonly costByModel: readonly (number | null)[] | null;
  };
}

type Settings = Readonly<Partial<Record<MonitorSettingKey, MonitorSettingValue>>>;

const pick = (settings: Settings, key: MonitorSettingKey, fallback: string): string => {
  const value = settings[key];
  return typeof value === 'string' ? value : fallback;
};

const time = (iso: string | null): number => {
  if (iso === null) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
};

const EXCERPT = 300;
const MAX_TEXT = 6000;
const MAX_ITEMS = 12;

export function projectViewerMonitor(
  source: ViewerMonitorSource,
  settings: Settings,
): ViewerMonitorView {
  const level =
    pick(settings, 'monitor.redaction', 'strict') === 'standard' ? 'standard' : 'strict';
  const words = Array.isArray(settings['monitor.blocked_words'])
    ? settings['monitor.blocked_words']
    : [];
  const mask = (text: string): string => redactText(text, { level, blockedWords: words });
  const delayRaw = settings['monitor.delay_s'];
  const delayS = typeof delayRaw === 'number' && delayRaw >= 0 ? delayRaw : 3;
  const visible = (iso: string | null): boolean => time(iso) <= source.nowMs - delayS * 1000;

  const generatedAt = new Date(source.nowMs).toISOString();
  if (!source.project) {
    return {
      generatedAt,
      delayS,
      project: null,
      person: null,
      transcript: null,
      stages: [],
      gates: null,
      documents: null,
      research: null,
      agents: null,
      assistant: null,
      usage: null,
    };
  }
  const project = source.project;

  const nameSetting = pick(settings, 'monitor.viewer.project_name', 'real');
  const detail = pick(settings, 'monitor.viewer.stage_detail', 'times');
  const outputs = pick(settings, 'monitor.viewer.stage_outputs', 'full');
  const errors = pick(settings, 'monitor.viewer.errors', 'message');
  const stampsShown = pick(settings, 'monitor.viewer.timestamps', 'relative') !== 'hidden';

  const stages: ViewerMonitorStage[] = source.stages.map((stage) => {
    const showOutput = outputs !== 'hidden' && stage.outputText !== null && visible(stage.outputAt);
    const text = stage.outputText === null ? '' : stage.outputText.slice(0, MAX_TEXT);
    return {
      stage: stage.stage,
      status: stage.status,
      current: stage.stage === project.currentStage,
      startedAt: detail !== 'status' && stampsShown ? stage.startedAt : null,
      completedAt: detail !== 'status' && stampsShown ? stage.completedAt : null,
      attempts: detail === 'attempts' ? stage.attempts : null,
      output: showOutput
        ? {
            title: stage.outputTitle === null ? null : mask(stage.outputTitle.slice(0, 200)),
            text:
              outputs === 'title'
                ? null
                : mask(outputs === 'excerpt' ? text.slice(0, EXCERPT) : text),
          }
        : null,
      error:
        errors !== 'hidden' && (stage.status === 'failed' || stage.status === 'rejected')
          ? {
              message:
                errors === 'message' && stage.errorText !== null
                  ? mask(stage.errorText.slice(0, 500))
                  : null,
            }
          : null,
    };
  });

  const gatesSetting = pick(settings, 'monitor.viewer.human_gates', 'status');
  const documentsSetting = pick(settings, 'monitor.viewer.documents', 'preview');
  const agentsSetting = pick(settings, 'monitor.viewer.agents', 'roles_actions');
  const assistantSetting = pick(settings, 'monitor.viewer.assistant_activity', 'steps');
  const modelSetting = pick(settings, 'monitor.viewer.model_info', 'hidden');
  const tokensSetting = pick(settings, 'monitor.viewer.tokens', 'hidden');
  const costSetting = pick(settings, 'monitor.viewer.cost', 'hidden');
  const peopleSetting = pick(settings, 'monitor.viewer.people', 'role');
  const transcriptSetting = pick(settings, 'monitor.viewer.assistant_transcript', 'hidden');
  const qualitySetting = pick(settings, 'monitor.viewer.quality_scores', 'score');
  const researchSetting = pick(settings, 'monitor.viewer.research_sources', 'full');

  let researchView: ViewerMonitorView['research'] = null;
  if (researchSetting !== 'hidden') {
    const web = source.research.filter((item) => item.url !== null);
    const hostOf = (url: string): string | null => {
      try {
        return new URL(url).hostname.replace(/^www\./u, '');
      } catch {
        return null;
      }
    };
    const hosts = web
      .map((item) => hostOf(item.url ?? ''))
      .filter((host): host is string => host !== null);
    researchView = {
      count: source.research.length,
      verified: source.research.filter((item) => item.verified).length,
      internal: source.research.length - web.length,
      domains:
        researchSetting === 'domains' || researchSetting === 'full'
          ? [...new Set(hosts)].slice(0, MAX_ITEMS * 2).map((host) => mask(host))
          : null,
      sources:
        researchSetting === 'full'
          ? source.research.slice(0, MAX_ITEMS * 2).map((item) => ({
              title: item.title === null ? null : mask(item.title.slice(0, 300)),
              url: item.url === null ? null : mask(item.url.slice(0, 500)),
              verified: item.verified,
            }))
          : null,
    };
  }

  let usage: ViewerMonitorView['usage'] = null;
  if (modelSetting !== 'hidden' || tokensSetting !== 'hidden' || costSetting !== 'hidden') {
    const splitting = tokensSetting === 'split';
    const models =
      modelSetting === 'hidden' && tokensSetting === 'hidden'
        ? []
        : source.usage.map((row) => ({
            provider: row.provider,
            model: modelSetting === 'full' ? mask(row.model) : null,
            tokens: row.inputTokens + row.outputTokens,
            input: splitting ? row.inputTokens : null,
            output: splitting ? row.outputTokens : null,
          }));
    usage = {
      models: modelSetting === 'hidden' ? [] : models,
      tokensTotal:
        tokensSetting === 'hidden'
          ? null
          : source.usage.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0),
      costUsd:
        costSetting === 'hidden' ? null : source.usage.reduce((sum, row) => sum + row.costUsd, 0),
      costByModel:
        costSetting === 'detailed' && modelSetting !== 'hidden'
          ? source.usage.map((row) => row.costUsd)
          : null,
    };
  }

  return {
    generatedAt,
    delayS,
    project: {
      name: nameSetting === 'real' ? mask(project.title) : null,
      code: nameSetting === 'hidden' ? null : mask(project.code),
      status: project.status,
      currentStage: project.currentStage,
      topics:
        pick(settings, 'monitor.viewer.topic_names', 'shown') === 'shown'
          ? source.topics.slice(0, MAX_ITEMS).map((topic) => mask(topic.slice(0, 200)))
          : null,
      business:
        pick(settings, 'monitor.viewer.business_name', 'hidden') === 'shown' &&
        source.businessName !== null
          ? mask(source.businessName.slice(0, 200))
          : null,
    },
    person:
      peopleSetting === 'hidden'
        ? null
        : {
            role: 'owner',
            name:
              peopleSetting === 'first_name'
                ? mask(source.person.firstName)
                : peopleSetting === 'full_name'
                  ? mask(source.person.fullName)
                  : null,
          },
    transcript:
      transcriptSetting === 'hidden'
        ? null
        : source.transcript
            .filter((line) => transcriptSetting === 'full' || line.role === 'assistant')
            .filter((line) => visible(line.createdAt))
            .slice(-MAX_ITEMS)
            .map((line) => ({
              role: line.role,
              text: mask(line.content.slice(0, 1000)),
              at: line.createdAt,
            })),
    stages,
    gates:
      gatesSetting === 'hidden'
        ? null
        : source.gates
            .filter((gate) => visible(gate.createdAt))
            .slice(-MAX_ITEMS)
            .map((gate) => ({ title: mask(gate.title.slice(0, 300)), status: gate.status })),
    documents:
      documentsSetting === 'hidden'
        ? null
        : source.documents
            .filter((document) => visible(document.updatedAt))
            .slice(0, MAX_ITEMS)
            .map((document) => ({
              title: mask(document.title.slice(0, 300)),
              status: document.status,
              preview:
                documentsSetting === 'preview' && document.preview !== null
                  ? mask(document.preview.slice(0, EXCERPT))
                  : null,
              quality:
                qualitySetting === 'hidden' || document.quality === null
                  ? null
                  : {
                      passed: document.quality.status === 'passed',
                      score:
                        qualitySetting === 'score' && Number.isFinite(document.quality.overall)
                          ? document.quality.overall
                          : null,
                    },
            })),
    research: researchView,
    agents:
      agentsSetting === 'hidden'
        ? null
        : source.agents.map((agent) => ({
            role: agent.role,
            calls: agent.calls,
            last:
              agentsSetting === 'roles_actions' && agent.lastTool !== null && visible(agent.lastAt)
                ? { tool: mask(agent.lastTool), decision: agent.lastDecision }
                : null,
          })),
    assistant:
      assistantSetting === 'hidden'
        ? null
        : {
            live: source.assistantLive,
            steps:
              assistantSetting === 'status'
                ? null
                : source.actions
                    .filter((action) => visible(action.proposedAt))
                    .slice(-MAX_ITEMS)
                    .map((action) => ({
                      status: action.status,
                      summary: mask(action.summary.slice(0, 500)),
                      target:
                        assistantSetting === 'steps_targets' && action.targetName !== null
                          ? mask(action.targetName)
                          : null,
                    })),
          },
    usage,
  };
}
