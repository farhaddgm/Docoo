import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MonitorService } from '../src/monitor/monitor.service.js';
import type { WorkspaceRequestContext } from '../src/common/request-context.js';

const writeAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/common/audit.js', () => ({ writeAudit }));

const context = {
  workspaceId: '810b1170-629e-4718-b880-5cb0b81d6f32',
  actorId: '405c9eaa-d469-493c-94b3-6ec7744df8e7',
} as unknown as WorkspaceRequestContext;

function service(values: Record<string, unknown>) {
  const client = {};
  const database = {
    run: vi.fn((_context: unknown, work: (c: unknown) => unknown) => work(client)),
  };
  const config = { resolve: vi.fn().mockResolvedValue({ values }) };
  return {
    client,
    config,
    monitor: new MonitorService(database as never, config as never),
  };
}

describe('MonitorService', () => {
  beforeEach(() => writeAudit.mockClear());

  it('reports both monitors off with the careful defaults when nothing is saved', async () => {
    const { monitor } = service({});
    const config = await monitor.clientConfig(context);
    expect(config.viewerEnabled).toBe(false);
    expect(config.voiceEnabled).toBe(false);
    expect(config.settings['monitor.viewer.cost']).toBe('hidden');
    expect(config.settings['monitor.redaction']).toBe('strict');
  });

  it('reads the settings of the workspace and ignores a value that is not allowed', async () => {
    const { monitor, config } = service({
      'monitor.viewer.enabled': true,
      'monitor.viewer.cost': 'total',
      'monitor.voice.enabled': 'yes',
      'monitor.delay_s': 99,
    });
    const result = await monitor.clientConfig(context);
    expect(config.resolve).toHaveBeenCalledWith({}, context, 'workspace', context.workspaceId);
    expect(result.viewerEnabled).toBe(true);
    expect(result.voiceEnabled).toBe(false);
    expect(result.settings['monitor.viewer.cost']).toBe('total');
    expect(result.settings['monitor.delay_s']).toBe(3);
  });

  it('writes the control that was used to the audit trail, with no content', async () => {
    const { monitor, client } = service({});
    await monitor.report(context, { event: 'blackout', kind: 'all' });
    expect(writeAudit).toHaveBeenCalledWith(client, context, {
      action: 'monitor.blackout',
      targetType: 'monitor',
      targetId: null,
      after: { kind: 'all' },
    });
  });
});
