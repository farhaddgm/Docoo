import { describe, expect, it } from 'vitest';
import { meetingProblemPattern } from '@docoo/contracts';
import { defaultDefinition, STAGE_ROLE } from '@docoo/domain';
import { stagePrompt, STAGES } from './stages.js';
import { roundPrompt } from './analysis.js';

describe('optional pattern execution guidance', () => {
  it('applies selected principles in analyst questions and the final problem definition, keeping the unselected path intact', () => {
    const analysis = {
      round: 1,
      asked: 0,
      capacity: 5,
      transcript: [],
      coverage: [],
      coverageGaps: [],
      openContradictions: [],
      summaries: [],
      priorDefinition: null,
      problemPattern: {
        ...meetingProblemPattern,
        qualityCriteria: ['PROJECT_PATTERN_CRITERION'],
        boundaries: ['PROJECT_PATTERN_BOUNDARY'],
      },
    };
    const input = {
      language: 'en' as const,
      projectTitle: 'Planning',
      problem: 'Prepare for a conversation',
      topics: [],
      feedback: [],
      definition: defaultDefinition('analyst'),
      analysis,
    };
    for (const prompt of [
      roundPrompt(input),
      stagePrompt({ ...input, stage: 'analysis', previous: [] }),
    ]) {
      expect(prompt.instructions).toContain('project-specific requirements');
      expect(prompt.instructions).toContain('cannot override');
      expect(prompt.instructions).not.toContain('PROJECT_PATTERN_CRITERION');
      expect(prompt.message).toContain('PROJECT_PATTERN_CRITERION');
      expect(prompt.message).toContain('PROJECT_PATTERN_BOUNDARY');
    }
    const plain = roundPrompt({ ...input, analysis: { ...analysis, problemPattern: null } });
    expect(plain.message).not.toContain('problemPattern');
    expect(plain.instructions).not.toContain('project-specific requirements');
  });
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
      expect(guided.instructions).toContain('project-specific requirements');
      expect(guided.message).toContain('UNTRUSTED_PATTERN_OVERRIDE');
      if (stage === 'research')
        expect(guided.instructions).toContain('Do not call tools, invent evidence');
    });
  }
});
