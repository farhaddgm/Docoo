/**
 * امتیازدهی یک سناریو: آیا دستیار درست شنید و ابزار درست را با آرگومان درست صدا زد؟
 *
 * سناریو:
 *   id، spoken (آنچه گوینده می‌گوید)، entities (نام/عدد/تاریخ که باید در متن شنیده‌شده باشد)،
 *   expectTool: { name (رشته یا آرایه)، args: { کلید: مقدار | [مقدارهای پذیرفتنی] } }
 *   expectNoTool: true (باید بپرسد یا رد کند، نه ابزار صدا بزند)
 *
 * مقدار رشته‌ای «شامل» بودن را می‌سنجد (پس از نرمال‌سازی)؛ عدد برابری عددی؛ آرایه یعنی هر یک.
 */
import { entityInText, normalizeFa, wer } from './text.mjs';

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

export function compareValue(expected, got) {
  if (Array.isArray(expected)) return expected.some((option) => compareValue(option, got));
  if (got == null) return false;
  if (typeof expected === 'number') {
    const parsed = Number(normalizeFa(String(got)).replace(/ /gu, ''));
    return Number.isFinite(parsed) && parsed === expected;
  }
  const wanted = normalizeFa(String(expected));
  return (
    wanted.length > 0 &&
    normalizeFa(typeof got === 'string' ? got : JSON.stringify(got)).includes(wanted)
  );
}

export function scoreScenario(scenario, snapshot) {
  const heard = snapshot.userTranscripts.join(' ');
  const calls = snapshot.toolCalls;
  const entities = (scenario.entities ?? []).map((entity) => ({
    entity,
    hit: entityInText(heard, entity),
  }));

  let tool = null;
  if (scenario.expectTool) {
    const names = [].concat(scenario.expectTool.name);
    const call = calls.find((item) => names.includes(item.name));
    const args = Object.entries(scenario.expectTool.args ?? {}).map(([key, expected]) => {
      const got = call?.args ? getPath(call.args, key) : undefined;
      return { key, expected, got: got ?? null, ok: call ? compareValue(expected, got) : false };
    });
    tool = {
      expected: names,
      called: Boolean(call),
      calledName: call?.name ?? null,
      argsParsed: call ? call.argsError === null : false,
      args,
      ok: Boolean(call) && call.argsError === null && args.every((arg) => arg.ok),
    };
  }

  const first = snapshot.responses.find((entry) => entry.latencyMs !== null);
  return {
    id: scenario.id,
    heard,
    wer: scenario.spoken && heard ? wer(scenario.spoken, heard) : null,
    sttMissing: Boolean(scenario.spoken) && !heard,
    entities,
    tool,
    noToolOk: scenario.expectNoTool ? calls.length === 0 : null,
    latencyMs: first?.latencyMs ?? null,
    totals: snapshot.totals,
    errors: snapshot.errors.length,
  };
}
