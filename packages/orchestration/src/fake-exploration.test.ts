import {
  EXPLORATION_PROPOSAL_SCHEMA,
  EXPLORATION_PROPOSAL_SCHEMA_NAME,
  normalizeCandidates,
} from '@docoo/domain';
import type { NormalizedModelRequest } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { fakeExplorationResponder, fakeResponder } from './fake-responders.js';

const request = (
  data: unknown,
  language: 'Persian' | 'English',
  schema = EXPLORATION_PROPOSAL_SCHEMA_NAME,
): NormalizedModelRequest => ({
  model: 'fake-standard',
  instructions: `Write in ${language}.`,
  messages: [{ role: 'user', content: `<data>${JSON.stringify(data)}</data>` }],
  responseSchema: { name: schema, schema: EXPLORATION_PROPOSAL_SCHEMA },
});

describe('offline exploration answers', () => {
  it('proposes two usable candidates that the domain accepts', () => {
    const answer = fakeExplorationResponder(
      request({ eventText: 'Three clients left', candidates: [] }, 'English'),
    ) as { candidates: unknown[] };
    const { items, discarded } = normalizeCandidates(answer.candidates, { room: 10 });
    expect(items).toHaveLength(2);
    expect(discarded).toBe(0);
    expect(items[0]!.problemDraft).toContain('Three clients left');
  });

  it('numbers after the existing ones so a second proposal adds new candidates', () => {
    const first = (
      fakeExplorationResponder(request({ eventText: 'x', candidates: [] }, 'English')) as {
        candidates: { title: string }[];
      }
    ).candidates;
    const second = (
      fakeExplorationResponder(
        request(
          { eventText: 'x', candidates: [{ title: first[0]!.title }, { title: first[1]!.title }] },
          'English',
        ),
      ) as { candidates: { title: string }[] }
    ).candidates;
    expect(second.map((item) => item.title)).toEqual([
      'Candidate problem 3',
      'Candidate problem 4',
    ]);
  });

  it('answers in Persian when asked to, is reached through the shared responder and leaves other schemas alone', () => {
    const persian = fakeResponder(request({ eventText: 'x', candidates: [] }, 'Persian')) as {
      candidates: { title: string }[];
    };
    expect(persian.candidates[0]!.title).toBe('مسئلهٔ کاندید 1');
    expect(fakeExplorationResponder(request({}, 'English', 'something_else'))).toBeNull();
  });
});
