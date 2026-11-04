import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  liveActionStatuses,
  liveConfirmationVias,
  liveSessionEndReasons,
  liveAssistantModes,
  riskTiers,
} from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The ledger tables of the live assistant (migration 0085) and the contract the API and the web
 * page read must say the same things. The state machine itself is tested against a real database
 * in live-assistant.integration.test.ts; this keeps the lists and the guarantees of the file equal.
 */
const migrations = join(import.meta.dirname, '../../../packages/database/migrations');
const sql = readFileSync(join(migrations, '0085_live_assistant_ledger.sql'), 'utf8');

/** The values of `<column> ... CHECK(<column> IN ('a','b'))`, in the order written. */
function checkedValues(column: string): string[] {
  const match = new RegExp(`CHECK\\(${column} IN \\(([^)]*)\\)\\)`, 'u').exec(sql);
  if (!match?.[1]) throw new Error(`no CHECK list for ${column}`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((item) => item[1] as string);
}

describe('live assistant ledger (migration 0085)', () => {
  it('allows exactly the statuses, reasons and tiers of the contract', () => {
    expect(checkedValues('status').slice(0, 2)).toEqual(['active', 'ended']);
    const actionStatuses = [...sql.matchAll(/CHECK\(status IN \(([^)]*)\)\)/gu)].map((match) =>
      [...(match[1] ?? '').matchAll(/'([^']+)'/gu)].map((item) => item[1]),
    );
    expect(actionStatuses[1]).toEqual([...liveActionStatuses]);
    expect(checkedValues('end_reason')).toEqual([...liveSessionEndReasons]);
    expect(checkedValues('tier')).toEqual([...riskTiers]);
    expect(checkedValues('mode')).toEqual([...liveAssistantModes]);
    expect(checkedValues('first_confirmed_via')).toEqual([...liveConfirmationVias, 'auto']);
    expect(checkedValues('confirmed_via')).toEqual([...liveConfirmationVias, 'auto']);
  });

  it('keeps every table behind row security, forced, and grants no delete to the application', () => {
    for (const table of ['live_sessions', 'live_messages', 'live_actions']) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    }
    expect(sql).toMatch(
      /REVOKE ALL ON live_sessions, live_messages, live_actions FROM PUBLIC, docoo_app;/u,
    );
    const grants = [...sql.matchAll(/^GRANT ([A-Z, ]+) ON (\w+) TO docoo_app;$/gmu)];
    expect(grants.map((grant) => grant[2]).sort()).toEqual([
      'live_actions',
      'live_messages',
      'live_sessions',
    ]);
    for (const grant of grants) expect(grant[1], grant[2]).not.toMatch(/DELETE|TRUNCATE/u);
    // Nothing is deleted in place; history is only removed by the retention sweep.
    for (const table of ['live_sessions', 'live_actions']) {
      expect(sql).toMatch(
        new RegExp(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}`, 'u'),
      );
    }
    expect(sql).toMatch(
      /CREATE TRIGGER live_messages_append_only BEFORE UPDATE OR DELETE ON live_messages/u,
    );
  });

  it('scopes every policy to the workspace and to the one person who talked', () => {
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON (\w+)([\s\S]*?);\n/gu)];
    expect(policies.length).toBeGreaterThanOrEqual(8);
    for (const [, name, , body] of policies) {
      expect(body, name).toContain('workspace_id = app.current_workspace_id()');
      expect(body, name).toContain('user_id = app.current_actor_id()');
    }
  });

  it('lets a change be born only proposed or refused, and the database state machine mirrors the contract', () => {
    expect(sql).toMatch(/AND status IN \('proposed','refused'\)/u);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION app.live_actions_guard()');
    // The legal moves written into the trigger, one by one (nextLiveActionStatus).
    expect(sql).toContain(
      "OLD.status = 'proposed' AND NEW.status IN ('first_confirmed','confirmed','cancelled','expired')",
    );
    expect(sql).toContain(
      "OLD.status = 'first_confirmed' AND NEW.status IN ('confirmed','cancelled','expired')",
    );
    expect(sql).toContain("OLD.status = 'confirmed' AND NEW.status IN ('executed','failed')");
    expect(sql).toContain('an irreversible change needs two confirmations');
    expect(sql).toContain('the time to confirm has passed');
  });
});

describe('live assistant taint (migration 0086)', () => {
  const taint = readFileSync(join(migrations, '0086_live_assistant_taint.sql'), 'utf8');

  it('adds only the moment a session last read untrusted content', () => {
    expect(taint).toMatch(/ALTER TABLE live_sessions ADD COLUMN untrusted_read_at timestamptz;/u);
    expect(taint.match(/ALTER TABLE/gu)).toHaveLength(1);
    expect(taint).not.toMatch(/DROP|DELETE|TRUNCATE/u);
  });
});

describe('migration journal', () => {
  it('lists 0085_live_assistant_ledger right after 0084, in order', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === '0085_live_assistant_ledger');
    expect(at).toBeGreaterThan(0);
    const entry = journal.entries[at];
    const before = journal.entries[at - 1];
    expect(before?.tag).toBe('0084_live_assistant');
    expect(entry?.idx).toBe(before ? before.idx + 1 : -1);
    expect(entry && before ? entry.when > before.when : false).toBe(true);
  });

  it('lists 0086_live_assistant_taint right after 0085, in order', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === '0086_live_assistant_taint');
    expect(at).toBeGreaterThan(0);
    const entry = journal.entries[at];
    const before = journal.entries[at - 1];
    expect(before?.tag).toBe('0085_live_assistant_ledger');
    expect(entry?.idx).toBe(before ? before.idx + 1 : -1);
    expect(entry && before ? entry.when > before.when : false).toBe(true);
  });
});
