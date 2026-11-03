import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  accessScopeModes,
  assistantAccessLevels,
  confirmStrictnessLevels,
  liveAssistantLanguages,
  liveAssistantLimits,
  liveAssistantListeningModes,
  liveAssistantModes,
  liveAssistantSettingDefaults,
  liveAssistantSettingKeys,
  t3Categories,
} from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import { validateSettingValue, type SettingValueSchema } from '../src/config/setting-value.js';

/**
 * The live assistant's settings live in two places: the migration that seeds them and the contract
 * the web page and the policy code read (ADR-0055). This keeps the two equal, so a default or a
 * bound can never be changed in one and forgotten in the other.
 */
const migrations = join(import.meta.dirname, '../../../packages/database/migrations');
const sql = readFileSync(join(migrations, '0084_live_assistant.sql'), 'utf8');

interface Row {
  key: string;
  schema: SettingValueSchema & Record<string, unknown>;
  defaultValue: unknown;
  scopes: string;
  descriptionFa: string;
  descriptionEn: string;
}

const rows: Row[] = [
  ...sql.matchAll(
    /^ \('(live_assistant\.[a-z_0-9]+)', '(.+)', '([^']*)', '(\{[a-z,]+\})', (?:true|false),\n {2}'([^\n]+)',\n {2}'([^\n]+)'\)?[,;]$/gmu,
  ),
].map((match) => ({
  key: match[1] as string,
  schema: JSON.parse(match[2] as string) as Row['schema'],
  defaultValue: JSON.parse(match[3] as string) as unknown,
  scopes: match[4] as string,
  descriptionFa: match[5] as string,
  descriptionEn: match[6] as string,
}));
const row = (key: string): Row => {
  const found = rows.find((item) => item.key === key);
  if (!found) throw new Error(`no definition for ${key}`);
  return found;
};

describe('live assistant setting definitions (migration 0084)', () => {
  it('define exactly the keys of the contract, once each', () => {
    expect(rows.map((item) => item.key).sort()).toEqual([...liveAssistantSettingKeys].sort());
    expect(new Set(rows.map((item) => item.key)).size).toBe(rows.length);
    // Every row of the file was read: no definition escapes the check by being formatted oddly.
    expect(sql.match(/^ \('live_assistant\./gmu)?.length).toBe(rows.length);
  });

  it('seed the same defaults as the contract, and each default passes its own schema', () => {
    for (const item of rows) {
      expect(item.defaultValue, item.key).toEqual(
        liveAssistantSettingDefaults[item.key as keyof typeof liveAssistantSettingDefaults],
      );
      expect(validateSettingValue(item.schema, item.defaultValue), item.key).toBeNull();
    }
  });

  it('are workspace settings with a description in both languages', () => {
    for (const item of rows) {
      expect(item.scopes, item.key).toBe('{workspace}');
      expect(item.descriptionFa.length, item.key).toBeGreaterThan(5);
      expect(item.descriptionEn.length, item.key).toBeGreaterThan(5);
    }
  });

  it('allow exactly the values of the contract for every choice', () => {
    const choices: [string, readonly string[]][] = [
      ['live_assistant.access_scope', accessScopeModes],
      ['live_assistant.access_level', assistantAccessLevels],
      ['live_assistant.mode', liveAssistantModes],
      ['live_assistant.language', liveAssistantLanguages],
      ['live_assistant.listening_mode', liveAssistantListeningModes],
      ['live_assistant.confirm_strictness', confirmStrictnessLevels],
    ];
    for (const [key, values] of choices) expect(row(key).schema.enum, key).toEqual(values);
    expect((row('live_assistant.t3_categories').schema.items as { enum: string[] }).enum).toEqual([
      ...t3Categories,
    ]);
  });

  it('bound every cap by the same limits as the contract', () => {
    const limits: [string, { min: number; max: number }][] = [
      ['live_assistant.idle_sleep_s', liveAssistantLimits.idleSleepS],
      ['live_assistant.session_max_minutes', liveAssistantLimits.sessionMaxMinutes],
      ['live_assistant.session_cost_cap_usd', liveAssistantLimits.sessionCostCapUsd],
      ['live_assistant.daily_cost_cap_usd', liveAssistantLimits.dailyCostCapUsd],
      ['live_assistant.task_cost_cap_usd', liveAssistantLimits.taskCostCapUsd],
      ['live_assistant.max_actions_per_task', liveAssistantLimits.maxActionsPerTask],
      ['live_assistant.confirm_timeout_s', liveAssistantLimits.confirmTimeoutS],
      ['live_assistant.transcript_retention_days', liveAssistantLimits.transcriptRetentionDays],
    ];
    for (const [key, range] of limits) {
      expect(row(key).schema.minimum, key).toBe(range.min);
      expect(row(key).schema.maximum, key).toBe(range.max);
    }
  });

  it('the settings validator refuses what the page must never save', () => {
    const refuses = (key: string, value: unknown) =>
      expect(
        validateSettingValue(row(key).schema, value),
        `${key} = ${JSON.stringify(value)}`,
      ).not.toBeNull();
    const accepts = (key: string, value: unknown) =>
      expect(
        validateSettingValue(row(key).schema, value),
        `${key} = ${JSON.stringify(value)}`,
      ).toBeNull();

    refuses('live_assistant.access_scope', 'everything');
    refuses('live_assistant.access_level', 'admin');
    refuses('live_assistant.enabled', 'yes');
    refuses('live_assistant.display_name', '');
    refuses('live_assistant.display_name', 'x'.repeat(41));
    accepts('live_assistant.display_name', 'داکو');
    refuses('live_assistant.access_project_ids', ['not-a-uuid']);
    refuses(
      'live_assistant.access_project_ids',
      Array.from({ length: 201 }, () => '11111111-1111-4111-8111-111111111111'),
    );
    accepts('live_assistant.access_project_ids', ['11111111-1111-4111-8111-111111111111']);
    refuses('live_assistant.t3_categories', ['secrets']);
    refuses('live_assistant.t3_categories', [
      'delete',
      'accounts',
      'retention',
      'audit_override',
      'security_settings',
      'delete',
    ]);
    accepts('live_assistant.t3_categories', ['delete']);
    refuses('live_assistant.session_max_minutes', 60);
    refuses('live_assistant.session_cost_cap_usd', 0.1);
    refuses('live_assistant.max_actions_per_task', 2.5);
    refuses('live_assistant.connection_id', 'abc');
    accepts('live_assistant.connection_id', '');
    accepts('live_assistant.connection_id', '11111111-1111-4111-8111-111111111111');
  });
});

describe('migration journal', () => {
  it('lists 0084_live_assistant after the previous migration, in order', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === '0084_live_assistant');
    expect(at).toBeGreaterThan(0);
    const entry = journal.entries[at];
    const before = journal.entries[at - 1];
    expect(entry?.idx).toBe(before ? before.idx + 1 : -1);
    expect(entry && before ? entry.when > before.when : false).toBe(true);
  });
});
