'use client';

import { formatNumber, type Locale } from '../../../i18n';
import { wizardMessages } from './wizard-messages';

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  enabled: boolean;
}

/** What is wrong with the weights, in the same terms the server checks them (null when valid). */
export function criteriaIssue(criteria: readonly Criterion[]): 'none_enabled' | number | null {
  const enabled = criteria.filter((item) => item.enabled);
  if (enabled.length === 0) return 'none_enabled';
  const total = enabled.reduce((sum, item) => sum + item.weight, 0);
  return total === 100 ? null : total;
}

export const sameCriteria = (a: readonly Criterion[], b: readonly Criterion[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Enable, rename and reweight the solution criteria of the project being created (FR-SOL-003). */
export function CriteriaEditor({
  locale,
  idPrefix,
  criteria,
  onChange,
}: {
  locale: Locale;
  idPrefix: string;
  criteria: Criterion[];
  onChange: (next: Criterion[]) => void;
}) {
  const text = wizardMessages(locale);
  const patch = (key: string, change: Partial<Criterion>) =>
    onChange(criteria.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const total = criteria.filter((item) => item.enabled).reduce((sum, item) => sum + item.weight, 0);
  const issue = criteriaIssue(criteria);
  return (
    <div className="stack">
      <h3 id={`${idPrefix}-title`}>{text.criteriaTitle}</h3>
      <p className="muted">{text.criteriaHelp}</p>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-labelledby={`${idPrefix}-title`}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">{text.enabled}</th>
              <th scope="col">{text.criterion}</th>
              <th scope="col">{text.weight}</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((item) => (
              <tr key={item.key}>
                <td>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    aria-label={`${text.enabled}: ${item.label}`}
                    onChange={(event) => patch(item.key, { enabled: event.target.checked })}
                  />
                </td>
                <td>
                  <input
                    className="inline-input"
                    dir="auto"
                    value={item.label}
                    maxLength={200}
                    required
                    aria-label={`${text.criterion} (${item.key})`}
                    onChange={(event) => patch(item.key, { label: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="inline-input narrow"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={item.weight}
                    aria-label={`${text.weight}: ${item.label}`}
                    onChange={(event) =>
                      patch(item.key, { weight: Math.round(Number(event.target.value)) })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {text.total}
              </th>
              <td>
                <span className={`badge ${total === 100 ? 'state-passed' : 'state-failed'}`}>
                  {formatNumber(locale, total)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {issue !== null && (
        <p className="notice error" role="alert">
          {issue === 'none_enabled'
            ? text.criteriaNoneEnabled
            : text.criteriaNotHundred.replace('{n}', formatNumber(locale, issue))}
        </p>
      )}
    </div>
  );
}
