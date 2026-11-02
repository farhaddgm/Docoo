'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Notice, useAction } from '../use-action';
import { settingsMessages } from './settings-messages';

interface Suggestion {
  domain: string;
  trusted: number;
}

/**
 * Domains the administrator keeps trusting in research conflicts (ADR-0050), offered one by one for
 * the official list. Nothing is added until they press the button; the list is only ever extended
 * by the exact host they trusted.
 */
export function SourceSuggestions({
  locale,
  workspaceId,
  current,
  sequence,
  onSaved,
}: {
  locale: Locale;
  workspaceId: string;
  /** The official domains in force now. */
  current: readonly string[];
  /** The version of the assignment the list is saved over (0 when none exists yet). */
  sequence: number;
  onSaved: () => void;
}) {
  const t = settingsMessages(locale).sourceSuggestions;
  const [items, setItems] = useState<Suggestion[]>([]);
  const action = useAction(() => t.failed);

  const load = useCallback(() => {
    apiGet<{ items: Suggestion[] }>(
      `/workspaces/${workspaceId}/settings/research-source-suggestions`,
    )
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const fresh = items.filter((item) => !current.includes(item.domain));
  if (fresh.length === 0) return null;
  return (
    <section className="notice info stack" aria-label={t.title}>
      <h4>{t.title}</h4>
      <p>{t.help}</p>
      <Notice notice={action.notice} />
      <ul className="plain-list">
        {fresh.map((item) => (
          <li key={item.domain}>
            <code dir="ltr">{item.domain}</code>{' '}
            <span className="muted">
              {fill(t.item, { domain: '', n: formatNumber(locale, item.trusted) }).replace(
                '— ',
                '',
              )}
            </span>{' '}
            <button
              type="button"
              className="secondary-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  async () => {
                    await apiSend('PUT', `/workspaces/${workspaceId}/settings/assignments`, {
                      scopeType: 'workspace',
                      scopeId: workspaceId,
                      key: 'research.official_domains',
                      value: [...current, item.domain],
                      reason: t.reason,
                      expectedSequence: sequence,
                    });
                    onSaved();
                    load();
                  },
                  fill(t.added, { domain: item.domain }),
                )
              }
            >
              {t.add}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
