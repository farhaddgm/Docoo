'use client';

import { useEffect, useState } from 'react';

import { apiGet } from '../../api-client';
import type { Locale } from '../../i18n';
import { settingsMessages } from './settings-messages';

interface Connection {
  id: string;
  name: string;
  provider: string;
  status: string;
}

interface Model {
  id: string;
  displayName: string;
  capabilities: { structuredOutput: boolean };
}

/**
 * Chooses the AI connection and model of a project (UX §5 step 4). An empty connection means
 * "inherit": nothing is set for the project and the workspace default applies. Only models with
 * structured output are offered, because every stage needs it.
 */
export function ModelPicker({
  locale,
  workspaceId,
  connectionId,
  model,
  disabled = false,
  idPrefix,
  onChange,
}: {
  locale: Locale;
  workspaceId: string;
  connectionId: string;
  model: string;
  disabled?: boolean;
  idPrefix: string;
  onChange: (connectionId: string, model: string) => void;
}) {
  const text = settingsMessages(locale).picker;
  const base = `/workspaces/${workspaceId}`;
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<{ items: Connection[] }>(`${base}/provider-connections`)
      .then(
        (result) => active && setConnections(result.items.filter((c) => c.status !== 'disabled')),
      )
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [base]);

  useEffect(() => {
    if (!connectionId) {
      setModels([]);
      return;
    }
    let active = true;
    apiGet<{ catalog: { models: Model[] } | null }>(
      `${base}/provider-connections/${connectionId}/models`,
    )
      .then((result) => active && setModels(result.catalog?.models ?? []))
      .catch(() => active && setModels([]));
    return () => {
      active = false;
    };
  }, [base, connectionId]);

  const usable = models.filter((item) => item.capabilities.structuredOutput);
  return (
    <div className="stack">
      {connections && connections.length === 0 && <p className="muted">{text.noConnections}</p>}
      {failed && <p className="notice error">{text.noConnections}</p>}
      <div className="filter-grid">
        <label htmlFor={`${idPrefix}-connection`}>{text.connection}</label>
        <select
          id={`${idPrefix}-connection`}
          value={connectionId}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, '')}
        >
          <option value="">{text.inherit}</option>
          {(connections ?? []).map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} ({connection.provider})
            </option>
          ))}
        </select>
      </div>
      {connectionId && (
        <div className="filter-grid">
          <label htmlFor={`${idPrefix}-model`}>{text.model}</label>
          <select
            id={`${idPrefix}-model`}
            value={model}
            disabled={disabled}
            onChange={(event) => onChange(connectionId, event.target.value)}
          >
            <option value="">{text.chooseModel}</option>
            {usable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
          {usable.length === 0 ? (
            <p className="muted">{text.noModels}</p>
          ) : (
            <p className="muted">{text.structuredOutputOnly}</p>
          )}
        </div>
      )}
    </div>
  );
}
