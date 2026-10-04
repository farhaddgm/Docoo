import type { ReactNode } from 'react';

import type { Locale } from '../../../i18n';
import { workflowMessages } from './workflow-messages';

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function pairs(value: unknown): { term: string; meaning: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    )
    .map((item) => ({ term: asText(item['term']), meaning: asText(item['meaning']) }))
    .filter((item) => item.term !== '');
}

function Block({
  title,
  highlight,
  children,
}: {
  title: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={highlight ? 'highlight' : undefined}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index} dir="auto">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * The problem definition in reading order (FR-ANL-005). Assumptions and unresolved points are
 * set apart so the final report cannot hide them (FR-ANL-006). Definitions written before the
 * analyst existed carry only a statement, assumptions and open questions; those still show.
 */
export function DefinitionView({
  locale,
  content,
}: {
  locale: Locale;
  content: Record<string, unknown>;
}) {
  const out = workflowMessages(locale).out;
  const unresolved = [...textList(content['unresolved']), ...textList(content['openQuestions'])];
  const glossary = pairs(content['glossary']);
  return (
    <div className="output-view definition-view">
      <Block title={out.problemStatement}>
        <p dir="auto">{asText(content['problemStatement'])}</p>
      </Block>
      {asText(content['needStatement']) !== '' && (
        <Block title={out.needStatement}>
          <p dir="auto">{asText(content['needStatement'])}</p>
        </Block>
      )}
      {(['objectives', 'constraints', 'stakeholders', 'successCriteria'] as const).map(
        (key) =>
          key in content && (
            <Block key={key} title={out[key]}>
              <Bullets items={textList(content[key])} empty={out.none} />
            </Block>
          ),
      )}
      <Block title={out.assumptions} highlight>
        <Bullets items={textList(content['assumptions'])} empty={out.none} />
      </Block>
      <Block title={out.unresolved} highlight>
        <Bullets items={unresolved} empty={out.none} />
      </Block>
      {glossary.length > 0 && (
        <Block title={out.glossary}>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={out.glossary}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{out.term}</th>
                  <th scope="col">{out.meaning}</th>
                </tr>
              </thead>
              <tbody>
                {glossary.map((row, index) => (
                  <tr key={index}>
                    <th scope="row" dir="auto">
                      {row.term}
                    </th>
                    <td dir="auto">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}
      {asText(content['recommendedScope']) !== '' && (
        <Block title={out.recommendedScope}>
          <p dir="auto">{asText(content['recommendedScope'])}</p>
        </Block>
      )}
      {'outOfScope' in content && (
        <Block title={out.outOfScope}>
          <Bullets items={textList(content['outOfScope'])} empty={out.none} />
        </Block>
      )}
    </div>
  );
}
