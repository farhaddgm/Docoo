import type { PromptResearchQuestion } from '@docoo/domain';

import { promptDigest } from './agents.js';
import { GAP_SCHEMA, gapPrompt, parseGaps, type QuestionCoverage } from './research-gaps.js';
import type { ModelRef } from './research-dual.js';

interface GapResponse {
  readonly response: { readonly finishReason: string; readonly json: unknown };
}

/**
 * Asks the model which of the open questions the notes so far answer (ADR-0049). Returns null when
 * the check could not be made (no budget, the call failed or came back unusable), and the loop
 * then goes on as it would without a gap finder: it never stops early on a check it did not get.
 */
export async function assessGaps(input: {
  readonly model: ModelRef;
  readonly asked: readonly PromptResearchQuestion[];
  readonly notes: string;
  readonly pages: readonly { readonly title: string; readonly url: string }[];
  readonly language: 'fa' | 'en';
  readonly affordable: () => Promise<boolean>;
  readonly invoke: (
    target: ModelRef,
    request: {
      model: string;
      instructions: string;
      messages: { role: 'user'; content: string }[];
      responseSchema: { name: string; schema: never };
      maxOutputTokens: number;
    },
    promptSha256: string,
  ) => Promise<GapResponse>;
}): Promise<QuestionCoverage[] | null> {
  if (input.asked.length === 0) return null;
  if (!(await input.affordable())) return null;
  const prompt = gapPrompt({
    language: input.language,
    questions: input.asked,
    notes: input.notes,
    pages: input.pages,
  });
  try {
    const { response } = await input.invoke(
      input.model,
      {
        model: input.model.model,
        instructions: prompt.instructions,
        messages: [{ role: 'user', content: prompt.message }],
        responseSchema: { name: 'research_gaps', schema: GAP_SCHEMA as never },
        maxOutputTokens: 1500,
      },
      promptDigest(prompt),
    );
    if (response.finishReason !== 'stop' || response.json === null) return null;
    return parseGaps(response.json, input.asked);
  } catch {
    return null;
  }
}
