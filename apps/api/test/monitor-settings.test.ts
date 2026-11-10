import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  monitorSettingDefaults,
  monitorSettingDefinitions,
  monitorSettingKeys,
  type MonitorSettingDefinition,
} from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import { validateSettingValue, type SettingValueSchema } from '../src/config/setting-value.js';

/**
 * The monitor settings live in two places: the migration that seeds them and the contract the
 * settings page and the server read (ADR-0056). This keeps the two equal, so a default, a choice or
 * a bound can never be changed in one and forgotten in the other.
 */
const migrations = join(import.meta.dirname, '../../../packages/database/migrations');
// The monitor settings are seeded by the first migration and added to by later ones.
const sql = ['0089_monitor_settings.sql', '0091_monitor_followups.sql']
  .map((file) => readFileSync(join(migrations, file), 'utf8'))
  .join('\n');

interface Row {
  key: string;
  schema: SettingValueSchema & Record<string, unknown>;
  defaultValue: unknown;
  scopes: string;
  sensitive: string;
  descriptionFa: string;
  descriptionEn: string;
}

const rows: Row[] = [
  ...sql.matchAll(
    /^ \('(monitor\.[a-z_0-9.]+)', '(.+)', '([^']*)', '(\{[a-z,]+\})', (true|false),\n {2}'([^\n]+)',\n {2}'([^\n]+)'\)?[,;]$/gmu,
  ),
].map((match) => ({
  key: match[1] as string,
  schema: JSON.parse(match[2] as string) as Row['schema'],
  defaultValue: JSON.parse(match[3] as string) as unknown,
  scopes: match[4] as string,
  sensitive: match[5] as string,
  descriptionFa: (match[6] as string).replaceAll("''", "'"),
  descriptionEn: (match[7] as string).replaceAll("''", "'"),
}));

const definitionOf = (key: string): MonitorSettingDefinition => {
  const found = (monitorSettingDefinitions as readonly MonitorSettingDefinition[]).find(
    (item) => item.key === key,
  );
  if (!found) throw new Error(`no definition for ${key}`);
  return found;
};

describe('monitor setting definitions (migrations 0089 and 0091)', () => {
  it('define exactly the keys of the contract, once each, in the same order', () => {
    expect(rows.map((item) => item.key)).toEqual([...monitorSettingKeys]);
    // Every row of the file was read: no definition escapes the check by being formatted oddly.
    expect(sql.match(/^ \('monitor\./gmu)?.length).toBe(rows.length);
  });

  it('seed the same defaults as the contract, and each default passes its own schema', () => {
    for (const item of rows) {
      expect(item.defaultValue, item.key).toEqual(
        monitorSettingDefaults[item.key as keyof typeof monitorSettingDefaults],
      );
      expect(validateSettingValue(item.schema, item.defaultValue), item.key).toBeNull();
    }
  });

  it('are workspace settings, none of them secret, with the contract descriptions', () => {
    for (const item of rows) {
      const definition = definitionOf(item.key);
      expect(item.scopes, item.key).toBe('{workspace}');
      expect(item.sensitive, item.key).toBe('false');
      expect(item.descriptionFa, item.key).toBe(definition.fa);
      expect(item.descriptionEn, item.key).toBe(definition.en);
    }
  });

  it('allow exactly the choices, bounds and list limits of the contract', () => {
    for (const item of rows) {
      const definition = definitionOf(item.key);
      switch (definition.kind) {
        case 'boolean':
          expect(item.schema.type, item.key).toBe('boolean');
          break;
        case 'choice':
          expect(item.schema.type, item.key).toBe('string');
          expect(item.schema.enum, item.key).toEqual([...definition.options]);
          break;
        case 'integer':
        case 'number':
          expect(item.schema.type, item.key).toBe(definition.kind);
          expect(item.schema.minimum, item.key).toBe(definition.min);
          expect(item.schema.maximum, item.key).toBe(definition.max);
          break;
        case 'uuid':
          expect(item.schema.type, item.key).toBe('string');
          expect(validateSettingValue(item.schema, '')).toBeNull();
          expect(validateSettingValue(item.schema, 'not-an-id')).not.toBeNull();
          break;
        case 'words':
          expect(item.schema.type, item.key).toBe('array');
          expect(item.schema.maxItems, item.key).toBe(definition.maxItems);
          expect(item.schema.items?.maxLength, item.key).toBe(definition.maxLength);
          // An empty word is not a word: the pattern keeps empty texts out of the list.
          expect(validateSettingValue(item.schema, [''])).not.toBeNull();
          break;
      }
    }
  });

  it('refuse a value outside the allowed ones', () => {
    const cost = rows.find((item) => item.key === 'monitor.viewer.cost');
    expect(validateSettingValue(cost!.schema, 'detailed')).toBeNull();
    expect(validateSettingValue(cost!.schema, 'everything')).not.toBeNull();
    const delay = rows.find((item) => item.key === 'monitor.delay_s');
    expect(validateSettingValue(delay!.schema, 3)).toBeNull();
    expect(validateSettingValue(delay!.schema, 31)).not.toBeNull();
    expect(validateSettingValue(delay!.schema, 2.5)).not.toBeNull();
  });
});

describe('migration journal', () => {
  it('lists 0089_monitor_settings after the previous migration, in order', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === '0089_monitor_settings');
    expect(at).toBeGreaterThan(0);
    const entry = journal.entries[at];
    const before = journal.entries[at - 1];
    expect(entry?.idx).toBe(before ? before.idx + 1 : -1);
    expect(entry && before ? entry.when > before.when : false).toBe(true);
  });

  it('lists 0090_live_session_provider right after it, with the provider part of what a session started with', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === '0090_live_session_provider');
    expect(journal.entries[at - 1]?.tag).toBe('0089_monitor_settings');
    expect(journal.entries[at]?.idx).toBe((journal.entries[at - 1]?.idx ?? -2) + 1);
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
    const provider = readFileSync(join(migrations, '0090_live_session_provider.sql'), 'utf8');
    expect(provider).toMatch(/ADD COLUMN provider text NOT NULL DEFAULT ''/u);
    expect(provider).toMatch(/NEW\.provider <> OLD\.provider/u);
  });

  it('lists 0091_monitor_followups right after 0090, with the cache, the activity and the aliases', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === '0091_monitor_followups');
    expect(journal.entries[at - 1]?.tag).toBe('0090_live_session_provider');
    expect(journal.entries[at]?.idx).toBe((journal.entries[at - 1]?.idx ?? -2) + 1);
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
    const followups = readFileSync(join(migrations, '0091_monitor_followups.sql'), 'utf8');
    expect(followups).toMatch(/ADD COLUMN cached_input_tokens bigint NOT NULL DEFAULT 0/u);
    expect(followups).toMatch(/NEW\.cached_input_tokens < OLD\.cached_input_tokens/u);
    expect(followups).toMatch(
      /NEW\.executor_cached_input_tokens < OLD\.executor_cached_input_tokens/u,
    );
    expect(followups).toMatch(/NEW\.provider <> OLD\.provider/u);
    expect(followups).toMatch(/ALTER TABLE monitor_project_aliases FORCE ROW LEVEL SECURITY/u);
    expect(followups).toMatch(/activity IN \('listening','thinking','speaking','asleep'\)/u);
  });
});
