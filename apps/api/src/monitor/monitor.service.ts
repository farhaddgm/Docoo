import { Injectable } from '@nestjs/common';
import {
  monitorSettingsFrom,
  type MonitorClientConfig,
  type ReportMonitorEvent,
} from '@docoo/contracts';

import { writeAudit } from '../common/audit.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';

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
        viewerEnabled: settings['monitor.viewer.enabled'] === true,
        voiceEnabled: settings['monitor.voice.enabled'] === true,
        settings,
      };
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
