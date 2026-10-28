import { describe, expect, it, vi } from 'vitest';
import { meetingProblemPattern } from '@docoo/contracts';
import { PatternAiProvider } from './pattern-ai.provider.js';
import type { PatternRuntimeService } from '../pattern-runtime/pattern-runtime.service.js';

describe('pattern authoring identity', () => {
  it('keeps the administrator identifier when AI proposes a complete pattern', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: {
        answer: 'Here are reusable principles.',
        definition: { ...meetingProblemPattern, key: 'ai-renamed-key' },
        preview: null,
      },
      metadata: { provider: 'test', modelId: 'test' },
    });
    const provider = new PatternAiProvider({ invoke } as unknown as PatternRuntimeService);
    const definition = { ...meetingProblemPattern, key: 'pattern-admin-selected' };
    const result = await provider.complete({
      mode: 'chat',
      definition,
      content: 'Build principles for difficult conversations',
      history: [],
      context: { workspaceId: 'workspace', actorId: 'actor', correlationId: 'correlation' },
      signal: new AbortController().signal,
    });
    expect(result.definition?.key).toBe(definition.key);
    expect(result.definition?.purpose).toBe(meetingProblemPattern.purpose);
  });
});
