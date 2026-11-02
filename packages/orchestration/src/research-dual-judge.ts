import { ProviderError } from '@docoo/providers';

import { promptDigest } from './agents.js';
import {
  JUDGE_SCHEMA,
  judgeCanCompare,
  judgePrompt,
  mergeConflicts,
  parseJudge,
  type JudgeInfo,
  type ModelRef,
} from './research-dual.js';
import { RESEARCH_LIMITS, type WebRun } from './research.js';

interface JudgeResponse {
  readonly response: { readonly finishReason: string; readonly json: unknown };
}

/** The claims of the researcher's answer with the refs they cite, for the judge to read. */
function claimsOf(answer: unknown): { claim: string; refs: string[] }[] {
  const raw =
    answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>) : {};
  const findings = Array.isArray(raw['findings']) ? raw['findings'] : [];
  return findings.flatMap((item) => {
    const entry =
      item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    if (typeof entry['claim'] !== 'string' || entry['claim'] === '') return [];
    const evidence = Array.isArray(entry['evidence']) ? entry['evidence'] : [];
    const refs = evidence.flatMap((cite) =>
      cite !== null &&
      typeof cite === 'object' &&
      typeof (cite as { ref?: unknown }).ref === 'string'
        ? [(cite as { ref: string }).ref]
        : [],
    );
    return [{ claim: entry['claim'].slice(0, 500), refs }];
  });
}

/**
 * Asks the judge where the two models' pages disagree and adds those disagreements to the
 * researcher's `conflicts` (ADR-0047). Nothing here may fail the stage: with nothing to compare,
 * no budget, or a failed or unusable judge answer, the researcher's answer goes on unchanged and
 * the output says why the judge did not report.
 */
export async function judgeDualResearch(input: {
  readonly judge: ModelRef;
  readonly web: WebRun;
  readonly answer: unknown;
  readonly language: 'fa' | 'en';
  readonly problem: string;
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
  ) => Promise<JudgeResponse>;
}): Promise<{ web: WebRun; answer: unknown }> {
  const dual = input.web.dual;
  if (!dual) return { web: input.web, answer: input.answer };
  const finish = (
    status: JudgeInfo['status'],
    code: string | null,
    conflicts: number,
    answer: unknown,
  ) => ({
    web: {
      ...input.web,
      dual: { ...dual, judge: { model: input.judge.model, status, code, conflicts } },
    },
    answer,
  });

  if (!judgeCanCompare(input.web.sources))
    return finish('skipped', 'nothing_to_compare', 0, input.answer);
  if (!(await input.affordable())) return finish('skipped', 'cost_limit_exceeded', 0, input.answer);

  const prompt = judgePrompt({
    language: input.language,
    problem: input.problem,
    findings: claimsOf(input.answer),
    pages: input.web.sources,
  });
  try {
    const { response } = await input.invoke(
      input.judge,
      {
        model: input.judge.model,
        instructions: prompt.instructions,
        messages: [{ role: 'user', content: prompt.message }],
        responseSchema: { name: 'research_judge', schema: JUDGE_SCHEMA as never },
        maxOutputTokens: 3000,
      },
      promptDigest(prompt),
    );
    if (response.finishReason !== 'stop' || response.json === null) {
      return finish('failed', `judge_${response.finishReason}`, 0, input.answer);
    }
    const judged = parseJudge(response.json, input.web.sources);
    const raw =
      input.answer !== null && typeof input.answer === 'object'
        ? (input.answer as Record<string, unknown>)
        : {};
    const own = Array.isArray(raw['conflicts'])
      ? (raw['conflicts'] as { description?: unknown; refs?: unknown }[]).flatMap((item) =>
          item && typeof item.description === 'string' && Array.isArray(item.refs)
            ? [
                {
                  description: item.description,
                  refs: item.refs.filter((ref): ref is string => typeof ref === 'string'),
                },
              ]
            : [],
        )
      : [];
    const conflicts = mergeConflicts(own, judged, RESEARCH_LIMITS.maxConflicts);
    return finish('used', null, judged.length, { ...raw, conflicts });
  } catch (error) {
    return finish(
      'failed',
      error instanceof ProviderError ? error.code : 'judge_failed',
      0,
      input.answer,
    );
  }
}
