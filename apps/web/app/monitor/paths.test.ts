import { describe, expect, it } from 'vitest';

import { isMonitorWindowPath, monitorWindowName, monitorWindowPath } from './paths';

describe('monitor window paths', () => {
  it('gives each kind one fixed window name, so a second click reuses the window', () => {
    expect(monitorWindowName('viewer')).toBe('docoo-monitor-viewer');
    expect(monitorWindowName('voice')).toBe('docoo-monitor-voice');
    expect(monitorWindowName('viewer')).not.toBe(monitorWindowName('voice'));
  });

  it('puts the window under the locale of the back office', () => {
    expect(monitorWindowPath('fa', 'viewer')).toBe('/fa/monitor/viewer');
    expect(monitorWindowPath('en', 'voice')).toBe('/en/monitor/voice');
  });

  it('recognises the two windows and nothing else', () => {
    expect(isMonitorWindowPath('/fa/monitor/viewer')).toBe(true);
    expect(isMonitorWindowPath('/en/monitor/voice/')).toBe(true);
    // The launcher and the settings page are back-office pages with the menu.
    expect(isMonitorWindowPath('/fa/monitor')).toBe(false);
    expect(isMonitorWindowPath('/fa/monitor/settings')).toBe(false);
    expect(isMonitorWindowPath('/fa/monitor/viewer/extra')).toBe(false);
    // A share link page is a bare window too, but only with a whole token.
    const token = 'a'.repeat(43);
    expect(isMonitorWindowPath(`/fa/monitor/share/${token}`)).toBe(true);
    expect(isMonitorWindowPath('/fa/monitor/share/short')).toBe(false);
    expect(isMonitorWindowPath('/fa/monitor/share')).toBe(false);
    expect(isMonitorWindowPath('/de/monitor/viewer')).toBe(false);
    expect(isMonitorWindowPath('/fa/projects')).toBe(false);
    expect(isMonitorWindowPath(null)).toBe(false);
    expect(isMonitorWindowPath(undefined)).toBe(false);
  });
});
