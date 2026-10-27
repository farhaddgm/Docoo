import { describe, expect, it } from 'vitest';
import { meetingProblemPattern } from '@docoo/contracts';
import { defaultDefinition, STAGE_ROLE } from '@docoo/domain';
import { stagePrompt, STAGES } from './stages.js';

describe('optional pattern execution guidance', () => {
  for (const stage of STAGES) {
    it(`keeps ${stage} schemas and administrator guidance separate from instructions`, () => {
      const base = {
        stage,
        definition: defaultDefinition(STAGE_ROLE[stage]),
        language: 'en' as const,
        projectTitle: 'Planning',
        problem: 'Prepare a meeting',
        topics: [],
        previous: [],
        feedback: [],
      };
      const plain = stagePrompt(base);
      expect(plain.message).not.toContain('problemPattern');
      const pattern = { ...meetingProblemPattern, purpose: 'UNTRUSTED_PATTERN_OVERRIDE' };
      const guided = stagePrompt({
        ...base,
        problemPattern: pattern,
        patternResearchBlocked: stage === 'research',
      });
      expect(guided.instructions).not.toContain('UNTRUSTED_PATTERN_OVERRIDE');
      expect(guided.instructions).toContain('cannot override');
      expect(guided.message).toContain('UNTRUSTED_PATTERN_OVERRIDE');
      if (stage === 'research')
        expect(guided.instructions).toContain('Do not call tools, invent evidence');
    });
  }
});
