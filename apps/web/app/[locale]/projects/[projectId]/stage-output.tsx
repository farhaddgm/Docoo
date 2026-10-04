import type { ReactNode } from 'react';

import type { Locale } from '../../../i18n';
import { workflowMessages } from './workflow-messages';

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : [];
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
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
 * Readable view of a stage output (docs/03-ai: structured output of each stage). Anything
 * that does not match the expected shape falls back to formatted JSON, so nothing is hidden.
 */
export function StageOutput({
  locale,
  stage,
  content,
}: {
  locale: Locale;
  stage: string;
  content: unknown;
}) {
  const text = workflowMessages(locale).out;
  const data =
    typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : null;
  if (!data) return <pre className="json-block">{JSON.stringify(content, null, 2)}</pre>;

  switch (stage) {
    case 'analysis':
      return (
        <div className="output-view">
          <Block title={text.problemStatement}>
            <p dir="auto">{asText(data['problemStatement'])}</p>
          </Block>
          <Block title={text.assumptions}>
            <Bullets items={textList(data['assumptions'])} empty={text.none} />
          </Block>
          <Block title={text.openQuestions}>
            <Bullets items={textList(data['openQuestions'])} empty={text.none} />
          </Block>
        </div>
      );
    case 'research':
      return (
        <div className="output-view">
          <Block title={text.findings}>
            {objectList(data['findings']).length === 0 ? (
              <p className="muted">{text.none}</p>
            ) : (
              <ul>
                {objectList(data['findings']).map((finding, index) => (
                  <li key={index} dir="auto">
                    {asText(finding['claim'])}{' '}
                    <small className="muted">
                      ({text.source}: {asText(finding['source'])})
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title={text.gaps}>
            <Bullets items={textList(data['gaps'])} empty={text.none} />
          </Block>
        </div>
      );
    case 'ideation':
      return (
        <div className="output-view">
          <Block title={text.ideas}>
            {objectList(data['ideas']).length === 0 ? (
              <p className="muted">{text.none}</p>
            ) : (
              <ol>
                {objectList(data['ideas']).map((idea, index) => (
                  <li key={index} dir="auto">
                    <strong>{asText(idea['title'])}</strong> — {asText(idea['description'])}
                  </li>
                ))}
              </ol>
            )}
          </Block>
        </div>
      );
    case 'documentation':
      return (
        <div className="output-view">
          <Block title={text.outline}>
            {objectList(data['outline']).length === 0 ? (
              <p className="muted">{text.none}</p>
            ) : (
              <ol>
                {objectList(data['outline']).map((item, index) => (
                  <li key={index} dir="auto">
                    <strong>{asText(item['heading'])}</strong> — {asText(item['summary'])}
                  </li>
                ))}
              </ol>
            )}
          </Block>
        </div>
      );
    case 'evaluation':
      return (
        <div className="output-view">
          <Block title={text.scores}>
            {objectList(data['scores']).length === 0 ? (
              <p className="muted">{text.none}</p>
            ) : (
              <div className="table-scroll" tabIndex={0} role="region" aria-label={text.scores}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{text.criterion}</th>
                      <th scope="col">{text.score}</th>
                      <th scope="col">{text.evidence}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objectList(data['scores']).map((row, index) => (
                      <tr key={index}>
                        <th scope="row" dir="auto">
                          {asText(row['criterion'])}
                        </th>
                        <td>{typeof row['score'] === 'number' ? row['score'] : ''}</td>
                        <td dir="auto">{asText(row['evidence'])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Block>
          <Block title={text.summary}>
            <p dir="auto">{asText(data['summary'])}</p>
          </Block>
        </div>
      );
    default:
      return <pre className="json-block">{JSON.stringify(content, null, 2)}</pre>;
  }
}
