import type { MonitorKind } from '@docoo/contracts';

/** The settings a person in the room would notice, for the summary shown before a monitor opens. */
export const previewKeys: Readonly<Record<MonitorKind, readonly string[]>> = {
  viewer: [
    'monitor.viewer.stage_outputs',
    'monitor.viewer.documents',
    'monitor.viewer.research_sources',
    'monitor.viewer.business_name',
    'monitor.viewer.assistant_transcript',
    'monitor.viewer.model_info',
    'monitor.viewer.tokens',
    'monitor.viewer.cost',
    'monitor.viewer.errors',
    'monitor.viewer.people',
  ],
  voice: [
    'monitor.voice.transcript',
    'monitor.voice.action_cards',
    'monitor.voice.model_info',
    'monitor.voice.tokens',
    'monitor.voice.cost',
    'monitor.voice.access_info',
    'monitor.voice.people',
  ],
};

/** Whether a setting value means "nothing of this is shown", so the summary can mark it. */
export const isHiddenValue = (value: unknown): boolean => value === 'hidden';
