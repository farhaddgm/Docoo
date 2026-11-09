import { Injectable } from '@nestjs/common';
import {
  monitorSettingsFrom,
  pickCurrentSession,
  projectViewerMonitor,
  projectVoiceMonitor,
  type MonitorClientConfig,
  type ReportMonitorEvent,
  type ViewerMonitorSource,
  type ViewerMonitorView,
  type VoiceMonitorSource,
  type VoiceMonitorView,
  type VoiceSourceAction,
  type VoiceSourceMessage,
} from '@docoo/contracts';

import { writeAudit } from '../common/audit.js';
import { conflict } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { liveSettingsFrom } from '../live-assistant/live-gateway.js';
import { costPeriods } from '../live-assistant/live-store.js';
import {
  viewerActions,
  viewerAgents,
  viewerDocuments,
  viewerGates,
  viewerPerson,
  viewerProject,
  viewerResearch,
  viewerBusiness,
  viewerTopics,
  viewerTranscript,
  viewerStages,
  viewerUsage,
} from './monitor-viewer-store.js';
import { databaseNowMs, voiceActions, voiceMessages, voiceSessions } from './monitor-store.js';

const accepted = (settings: Record<string, unknown>): boolean =>
  settings['monitor.disclosure_accepted'] === true;

/** How many of the newest sessions the screen may choose from. */
const SESSIONS_READ = 50;
/** More lines than a screen shows, so the delay and the filter still leave enough. */
const LINES_READ = 80;

/**
 * The monitors (ADR-0056): read-only windows the owner puts on a room screen. This first step has
 * no screen content yet; it tells a window whether its monitor is switched on and how it should
 * look, and it keeps a content-free trail of what the owner did with the controls.
 */
@Injectable()
export class MonitorService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
  ) {}

  /** The saved monitor settings, with the careful default for anything missing or unusable. */
  async clientConfig(context: WorkspaceRequestContext): Promise<MonitorClientConfig> {
    return this.database.run(context, async (client) => {
      const resolved = await this.config.resolve(client, context, 'workspace', context.workspaceId);
      const settings = monitorSettingsFrom(resolved.values);
      return {
        // A monitor is on only after the owner accepted that the room sees what it shows.
        viewerEnabled: settings['monitor.viewer.enabled'] === true && accepted(settings),
        voiceEnabled: settings['monitor.voice.enabled'] === true && accepted(settings),
        settings,
      };
    });
  }

  /**
   * What the voice assistant monitor shows right now (ADR-0056 §6). Everything goes through
   * `projectVoiceMonitor`: what a setting hides is not in the answer, and the texts are masked.
   * A monitor that is switched off answers nothing.
   */
  async voiceView(context: WorkspaceRequestContext): Promise<VoiceMonitorView> {
    return this.database.run(context, async (client) => {
      const resolved = await this.config.resolve(client, context, 'workspace', context.workspaceId);
      const settings = monitorSettingsFrom(resolved.values);
      if (settings['monitor.voice.enabled'] !== true || !accepted(settings)) {
        throw conflict('MONITOR_OFF', 'The voice assistant monitor is switched off.');
      }
      const assistant = liveSettingsFrom(resolved.values);
      const nowMs = await databaseNowMs(client);
      const sessions = await voiceSessions(client, SESSIONS_READ);
      const current = pickCurrentSession(
        sessions,
        String(settings['monitor.voice.sessions']),
        nowMs,
      );

      // Only what a setting lets a screen show is read at all.
      let messages: VoiceSourceMessage[] = [];
      let actions: VoiceSourceAction[] = [];
      if (current && settings['monitor.voice.transcript'] !== 'hidden') {
        messages = await voiceMessages(client, current.id, LINES_READ);
      }
      if (current && settings['monitor.voice.action_cards'] !== 'hidden') {
        actions = await voiceActions(client, current.id);
      }
      const showsCost = settings['monitor.voice.cost'] !== 'hidden';
      const periods = showsCost ? await costPeriods(client, context.workspaceId) : null;
      const none = { costUsd: 0, tokens: 0, sessions: 0 };

      const voiceId = resolved.values['live_assistant.voice_id'];
      const source: VoiceMonitorSource = {
        nowMs,
        assistant: {
          displayName: assistant.displayName,
          language: assistant.language,
          voiceId: typeof voiceId === 'string' ? voiceId : '',
        },
        sessions,
        day: periods ? periods.day : none,
        month: periods ? periods.month : none,
        dailyCostCapUsd: assistant.caps.dailyCostCapUsd,
        messages,
        actions,
      };
      return projectVoiceMonitor(source, settings);
    });
  }

  /**
   * What the viewer monitor shows right now (ADR-0056 §7): the steps of the project the owner put
   * on the screen, through `projectViewerMonitor`. Switched off, it answers nothing.
   */
  async viewerView(context: WorkspaceRequestContext): Promise<ViewerMonitorView> {
    return this.database.run(context, async (client) => {
      const resolved = await this.config.resolve(client, context, 'workspace', context.workspaceId);
      const settings = monitorSettingsFrom(resolved.values);
      if (settings['monitor.viewer.enabled'] !== true || !accepted(settings)) {
        throw conflict('MONITOR_OFF', 'The viewer monitor is switched off.');
      }
      const nowMs = await databaseNowMs(client);
      const projectId = String(settings['monitor.viewer.project_id']);
      const project =
        projectId === '' ? null : await viewerProject(client, context.workspaceId, projectId);
      const empty: ViewerMonitorSource = {
        nowMs,
        project: null,
        stages: [],
        gates: [],
        documents: [],
        agents: [],
        actions: [],
        assistantLive: false,
        usage: [],
        research: [],
        person: { firstName: '', fullName: '' },
        topics: [],
        businessName: null,
        transcript: [],
      };
      if (!project) return projectViewerMonitor(empty, settings);
      const assistant = await viewerActions(client, projectId);
      return projectViewerMonitor(
        {
          nowMs,
          project,
          stages: await viewerStages(client, projectId),
          gates: await viewerGates(client, projectId),
          documents: await viewerDocuments(client, projectId),
          agents: await viewerAgents(client, projectId),
          actions: assistant.actions,
          assistantLive: assistant.live,
          usage: await viewerUsage(client, projectId),
          research: await viewerResearch(client, projectId),
          person: await viewerPerson(client, context.actorId),
          topics: await viewerTopics(client, projectId),
          businessName:
            settings['monitor.viewer.business_name'] === 'shown'
              ? await viewerBusiness(client, projectId)
              : null,
          transcript:
            settings['monitor.viewer.assistant_transcript'] === 'hidden'
              ? []
              : await viewerTranscript(client, 40),
        },
        settings,
      );
    });
  }

  /** Writes what control was used and for which monitor, never anything a monitor showed. */
  async report(context: WorkspaceRequestContext, input: ReportMonitorEvent): Promise<void> {
    await this.database.run(context, async (client) => {
      await writeAudit(client, context, {
        action: `monitor.${input.event}`,
        targetType: 'monitor',
        targetId: null,
        after: { kind: input.kind },
      });
    });
  }
}
