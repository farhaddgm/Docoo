'use client';

import { useState } from 'react';

import { formatNumber, type Locale } from '../../../i18n';
import type { DocBlock, DocRun } from './document-content';
import {
  addColumn,
  addPoint,
  addRow,
  findBibliography,
  insertAt,
  INSERTABLE_TYPES,
  itemsToText,
  MAX_APPENDIX_DEPTH,
  moveAt,
  newBlock,
  omitKey,
  nextReferenceId,
  removeAt,
  removeColumn,
  removePoint,
  removeRow,
  replaceAt,
  setCell,
  textToItems,
  toggleCitation,
  type BlockType,
} from './document-editor-model';
import { editorMessages, fill, type EditorMessages } from './editor-messages';

interface ListProps {
  readonly locale: Locale;
  readonly blocks: readonly DocBlock[];
  readonly onChange: (blocks: DocBlock[]) => void;
  /** Every block of the document, so a new id is unique across appendices too. */
  readonly all: readonly DocBlock[];
  readonly references: readonly { id: string; text: string }[];
  readonly depth: number;
  readonly disabled?: boolean | undefined;
}

const placeholders = (text: EditorMessages) => ({
  placeholder: {
    heading: text.newHeading,
    caption: text.newCaption,
    column: text.newColumn,
    label: text.newLabel,
    source: text.newSource,
    alt: text.newAlt,
  },
});

/** The editable list of blocks of a document or of an appendix. */
export function BlockList({
  locale,
  blocks,
  onChange,
  all,
  references,
  depth,
  disabled,
}: ListProps) {
  const text = editorMessages(locale);
  const [adding, setAdding] = useState<BlockType>('paragraph');

  const typeCount = new Map<string, number>();
  const names = blocks.map((block) => {
    const next = (typeCount.get(block.type) ?? 0) + 1;
    typeCount.set(block.type, next);
    return fill(text.blockNumber, {
      type: text.blockTypes[block.type] ?? block.type,
      n: formatNumber(locale, next),
    });
  });

  const types: BlockType[] = [
    ...INSERTABLE_TYPES.filter((type) => type !== 'appendix' || depth < MAX_APPENDIX_DEPTH),
  ];

  return (
    <div className="stack">
      {blocks.length === 0 && <p className="muted">{text.noBlocks}</p>}
      <ol className="editor-blocks" aria-label={text.blocks}>
        {blocks.map((block, index) => (
          <li key={block.id} id={`block-${block.id}`} className="editor-block" tabIndex={-1}>
            <div className="editor-block-head">
              <strong>{names[index]}</strong>
              <div className="toolbar" role="group" aria-label={names[index]}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || index === 0}
                  aria-label={fill(text.moveUp, { name: names[index]! })}
                  onClick={() => onChange(moveAt(blocks, index, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || index === blocks.length - 1}
                  aria-label={fill(text.moveDown, { name: names[index]! })}
                  onClick={() => onChange(moveAt(blocks, index, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="secondary-button danger"
                  disabled={disabled}
                  aria-label={fill(text.remove, { name: names[index]! })}
                  onClick={() => onChange(removeAt(blocks, index))}
                >
                  ×
                </button>
              </div>
            </div>
            <BlockFields
              locale={locale}
              block={block}
              name={names[index]!}
              all={all}
              references={references}
              depth={depth}
              disabled={disabled}
              onChange={(next) => onChange(replaceAt(blocks, index, next))}
            />
          </li>
        ))}
      </ol>
      <div className="toolbar editor-add">
        <label htmlFor={`add-type-${depth}`} className="visually-hidden">
          {text.addBlockType}
        </label>
        <select
          id={`add-type-${depth}`}
          className="inline-input"
          value={adding}
          disabled={disabled}
          onChange={(event) => setAdding(event.target.value as BlockType)}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {text.blockTypes[type]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() =>
            onChange(insertAt(blocks, blocks.length, newBlock(adding, all, placeholders(text))))
          }
        >
          {text.addBlock}
        </button>
        {depth === 0 && !findBibliography(all) && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() =>
              onChange(
                insertAt(blocks, blocks.length, newBlock('bibliography', all, placeholders(text))),
              )
            }
          >
            {text.addBibliography}
          </button>
        )}
      </div>
    </div>
  );
}

interface FieldsProps {
  readonly locale: Locale;
  readonly block: DocBlock;
  readonly name: string;
  readonly all: readonly DocBlock[];
  readonly references: readonly { id: string; text: string }[];
  readonly depth: number;
  readonly disabled: boolean | undefined;
  readonly onChange: (block: DocBlock) => void;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="editor-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function BlockFields({
  locale,
  block,
  name,
  all,
  references,
  depth,
  disabled,
  onChange,
}: FieldsProps) {
  const text = editorMessages(locale);
  const id = (suffix: string) => `ed-${block.id}-${suffix}`;

  switch (block.type) {
    case 'heading':
      return (
        <div className="editor-grid">
          <Field id={id('text')} label={text.headingText}>
            <input
              id={id('text')}
              className="inline-input"
              dir="auto"
              value={block.text}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </Field>
          <Field id={id('level')} label={text.headingLevel}>
            <select
              id={id('level')}
              className="inline-input narrow"
              value={block.level}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...block, level: Number(event.target.value) as 1 | 2 | 3 })
              }
            >
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {formatNumber(locale, level)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );

    case 'paragraph':
      return (
        <div className="stack">
          {block.runs.map((run, index) => (
            <fieldset key={index} className="editor-run">
              <legend>{fill(text.run, { n: formatNumber(locale, index + 1) })}</legend>
              <Field id={id(`run-${index}`)} label={text.runText}>
                <textarea
                  id={id(`run-${index}`)}
                  className="inline-input"
                  dir="auto"
                  rows={4}
                  value={run.text}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      runs: replaceAt<DocRun>(block.runs, index, {
                        ...run,
                        text: event.target.value,
                      }),
                    })
                  }
                />
              </Field>
              <div className="toolbar">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={run.bold === true}
                    disabled={disabled}
                    onChange={(event) => {
                      const rest = omitKey(run, 'bold');
                      onChange({
                        ...block,
                        runs: replaceAt<DocRun>(
                          block.runs,
                          index,
                          event.target.checked ? { ...rest, bold: true } : rest,
                        ),
                      });
                    }}
                  />{' '}
                  {text.bold}
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={run.italic === true}
                    disabled={disabled}
                    onChange={(event) => {
                      const rest = omitKey(run, 'italic');
                      onChange({
                        ...block,
                        runs: replaceAt<DocRun>(
                          block.runs,
                          index,
                          event.target.checked ? { ...rest, italic: true } : rest,
                        ),
                      });
                    }}
                  />{' '}
                  {text.italic}
                </label>
                {block.runs.length > 1 && (
                  <button
                    type="button"
                    className="secondary-button danger"
                    disabled={disabled}
                    aria-label={fill(text.removeRun, { n: formatNumber(locale, index + 1) })}
                    onClick={() => onChange({ ...block, runs: removeAt(block.runs, index) })}
                  >
                    ×
                  </button>
                )}
              </div>
              <fieldset className="editor-cites">
                <legend>{text.cites}</legend>
                {references.length === 0 ? (
                  <p className="muted">{text.noReferencesYet}</p>
                ) : (
                  references.map((reference) => (
                    <label key={reference.id} className="checkbox">
                      <input
                        type="checkbox"
                        checked={run.citations?.includes(reference.id) === true}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange({
                            ...block,
                            runs: replaceAt<DocRun>(
                              block.runs,
                              index,
                              toggleCitation(run, reference.id, event.target.checked),
                            ),
                          })
                        }
                      />{' '}
                      <span dir="auto">
                        {reference.id}: {reference.text}
                      </span>
                    </label>
                  ))
                )}
              </fieldset>
            </fieldset>
          ))}
          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() => onChange({ ...block, runs: [...block.runs, { text: '' }] })}
            >
              {text.addRun}
            </button>
          </div>
        </div>
      );

    case 'list':
      return (
        <div className="stack">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={block.ordered}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, ordered: event.target.checked })}
            />{' '}
            {text.ordered}
          </label>
          <Field id={id('items')} label={text.items}>
            <textarea
              id={id('items')}
              className="inline-input"
              dir="auto"
              rows={Math.max(3, block.items.length + 1)}
              value={itemsToText(block.items)}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, items: textToItems(event.target.value) })}
            />
          </Field>
        </div>
      );

    case 'table':
      return (
        <div className="stack">
          <div className="editor-grid">
            <Field id={id('caption')} label={text.caption}>
              <input
                id={id('caption')}
                className="inline-input"
                dir="auto"
                value={block.caption}
                disabled={disabled}
                onChange={(event) => onChange({ ...block, caption: event.target.value })}
              />
            </Field>
            <Field id={id('notes')} label={text.notes}>
              <input
                id={id('notes')}
                className="inline-input"
                dir="auto"
                value={block.notes ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  const rest = omitKey(block, 'notes');
                  onChange(event.target.value ? { ...rest, notes: event.target.value } : rest);
                }}
              />
            </Field>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={name}>
            <table>
              <thead>
                <tr>
                  {block.columns.map((column, columnIndex) => (
                    <th key={columnIndex} scope="col">
                      <label className="visually-hidden" htmlFor={id(`col-${columnIndex}`)}>
                        {fill(text.columnName, { n: formatNumber(locale, columnIndex + 1) })}
                      </label>
                      <input
                        id={id(`col-${columnIndex}`)}
                        className="inline-input"
                        dir="auto"
                        value={column}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange({
                            ...block,
                            columns: replaceAt(block.columns, columnIndex, event.target.value),
                          })
                        }
                      />
                      {block.columns.length > 1 && (
                        <button
                          type="button"
                          className="secondary-button danger"
                          disabled={disabled}
                          aria-label={fill(text.removeColumn, {
                            n: formatNumber(locale, columnIndex + 1),
                          })}
                          onClick={() => onChange(removeColumn(block, columnIndex))}
                        >
                          ×
                        </button>
                      )}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="visually-hidden">{text.addRow}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, columnIndex) => (
                      <td key={columnIndex}>
                        <label
                          className="visually-hidden"
                          htmlFor={id(`cell-${rowIndex}-${columnIndex}`)}
                        >
                          {fill(text.cell, {
                            row: formatNumber(locale, rowIndex + 1),
                            column: formatNumber(locale, columnIndex + 1),
                          })}
                        </label>
                        <input
                          id={id(`cell-${rowIndex}-${columnIndex}`)}
                          className="inline-input"
                          dir="auto"
                          value={cell}
                          disabled={disabled}
                          onChange={(event) =>
                            onChange(setCell(block, rowIndex, columnIndex, event.target.value))
                          }
                        />
                      </td>
                    ))}
                    <td>
                      {block.rows.length > 1 && (
                        <button
                          type="button"
                          className="secondary-button danger"
                          disabled={disabled}
                          aria-label={fill(text.removeRow, {
                            n: formatNumber(locale, rowIndex + 1),
                          })}
                          onClick={() => onChange(removeRow(block, rowIndex))}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() => onChange(addRow(block))}
            >
              {text.addRow}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || block.columns.length >= 8}
              onClick={() =>
                onChange(
                  addColumn(
                    block,
                    fill(text.column, { n: formatNumber(locale, block.columns.length + 1) }),
                  ),
                )
              }
            >
              {text.addColumn}
            </button>
          </div>
        </div>
      );

    case 'callout':
      return (
        <div className="stack">
          <Field id={id('tone')} label={text.tone}>
            <select
              id={id('tone')}
              className="inline-input narrow"
              value={block.tone}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...block, tone: event.target.value as 'info' | 'warning' | 'decision' })
              }
            >
              {(['info', 'warning', 'decision'] as const).map((tone) => (
                <option key={tone} value={tone}>
                  {text.tones[tone]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id('text')} label={text.callout}>
            <textarea
              id={id('text')}
              className="inline-input"
              dir="auto"
              rows={3}
              value={block.text}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </Field>
        </div>
      );

    case 'chart':
      return (
        <div className="stack">
          <div className="editor-grid">
            <Field id={id('kind')} label={text.chartKind}>
              <select
                id={id('kind')}
                className="inline-input narrow"
                value={block.kind}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...block, kind: event.target.value as 'bar' | 'line' })
                }
              >
                {(['bar', 'line'] as const).map((kind) => (
                  <option key={kind} value={kind}>
                    {text.kinds[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={id('title')} label={text.chartTitle}>
              <input
                id={id('title')}
                className="inline-input"
                dir="auto"
                value={block.title}
                disabled={disabled}
                onChange={(event) => onChange({ ...block, title: event.target.value })}
              />
            </Field>
            <Field id={id('unit')} label={text.unit}>
              <input
                id={id('unit')}
                className="inline-input"
                dir="auto"
                value={block.unit}
                disabled={disabled}
                onChange={(event) => onChange({ ...block, unit: event.target.value })}
              />
            </Field>
            <Field id={id('source')} label={text.source}>
              <input
                id={id('source')}
                className="inline-input"
                dir="auto"
                value={block.source}
                disabled={disabled}
                onChange={(event) => onChange({ ...block, source: event.target.value })}
              />
            </Field>
          </div>
          <Field id={id('alt')} label={text.alt}>
            <input
              id={id('alt')}
              className="inline-input"
              dir="auto"
              value={block.alt}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, alt: event.target.value })}
            />
          </Field>
          <ul className="editor-points">
            {block.labels.map((label, pointIndex) => (
              <li key={pointIndex} className="toolbar">
                <label className="visually-hidden" htmlFor={id(`label-${pointIndex}`)}>
                  {fill(text.label, { n: formatNumber(locale, pointIndex + 1) })}
                </label>
                <input
                  id={id(`label-${pointIndex}`)}
                  className="inline-input"
                  dir="auto"
                  value={label}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      labels: replaceAt(block.labels, pointIndex, event.target.value),
                    })
                  }
                />
                <label className="visually-hidden" htmlFor={id(`value-${pointIndex}`)}>
                  {fill(text.value, { n: formatNumber(locale, pointIndex + 1) })}
                </label>
                <input
                  id={id(`value-${pointIndex}`)}
                  className="inline-input narrow"
                  type="number"
                  step="any"
                  value={block.values[pointIndex] ?? 0}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      values: replaceAt(
                        block.values,
                        pointIndex,
                        Number.isFinite(event.target.valueAsNumber)
                          ? event.target.valueAsNumber
                          : 0,
                      ),
                    })
                  }
                />
                {block.labels.length > 1 && (
                  <button
                    type="button"
                    className="secondary-button danger"
                    disabled={disabled}
                    aria-label={fill(text.removePoint, { n: formatNumber(locale, pointIndex + 1) })}
                    onClick={() => onChange(removePoint(block, pointIndex))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                onChange(
                  addPoint(
                    block,
                    fill(text.label, { n: formatNumber(locale, block.labels.length + 1) }),
                  ),
                )
              }
            >
              {text.addPoint}
            </button>
          </div>
        </div>
      );

    case 'figure':
      return (
        <div className="stack">
          <p className="muted">{text.figureNote}</p>
          <Field id={id('ref')} label={text.assetRef}>
            <input id={id('ref')} className="inline-input" value={block.assetRef} readOnly />
          </Field>
          <Field id={id('caption')} label={text.caption}>
            <input
              id={id('caption')}
              className="inline-input"
              dir="auto"
              value={block.caption}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, caption: event.target.value })}
            />
          </Field>
          <Field id={id('alt')} label={text.alt}>
            <input
              id={id('alt')}
              className="inline-input"
              dir="auto"
              value={block.alt}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, alt: event.target.value })}
            />
          </Field>
        </div>
      );

    case 'pageBreak':
      return <p className="muted">{text.pageBreakNote}</p>;

    case 'appendix':
      return (
        <div className="stack">
          <Field id={id('title')} label={text.appendixTitle}>
            <input
              id={id('title')}
              className="inline-input"
              dir="auto"
              value={block.title}
              disabled={disabled}
              onChange={(event) => onChange({ ...block, title: event.target.value })}
            />
          </Field>
          <BlockList
            locale={locale}
            blocks={block.blocks}
            all={all}
            references={references}
            depth={depth + 1}
            disabled={disabled}
            onChange={(inner) => onChange({ ...block, blocks: inner })}
          />
        </div>
      );

    case 'bibliography':
      return (
        <div className="stack">
          <ul className="editor-points">
            {block.entries.map((entry, entryIndex) => (
              <li key={entry.id} className="editor-reference">
                <strong>{entry.id}</strong>
                <label className="visually-hidden" htmlFor={id(`ref-text-${entryIndex}`)}>
                  {text.referenceText} {entry.id}
                </label>
                <input
                  id={id(`ref-text-${entryIndex}`)}
                  className="inline-input"
                  dir="auto"
                  value={entry.text}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      entries: replaceAt(block.entries, entryIndex, {
                        ...entry,
                        text: event.target.value,
                      }),
                    })
                  }
                />
                <label className="visually-hidden" htmlFor={id(`ref-url-${entryIndex}`)}>
                  {text.referenceUrl} {entry.id}
                </label>
                <input
                  id={id(`ref-url-${entryIndex}`)}
                  className="inline-input"
                  dir="ltr"
                  inputMode="url"
                  value={entry.url ?? ''}
                  disabled={disabled}
                  onChange={(event) => {
                    const rest = omitKey(entry, 'url');
                    onChange({
                      ...block,
                      entries: replaceAt(
                        block.entries,
                        entryIndex,
                        event.target.value ? { ...rest, url: event.target.value } : rest,
                      ),
                    });
                  }}
                />
                <button
                  type="button"
                  className="secondary-button danger"
                  disabled={disabled}
                  aria-label={fill(text.removeReference, { id: entry.id })}
                  onClick={() =>
                    onChange({ ...block, entries: removeAt(block.entries, entryIndex) })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...block,
                  entries: [...block.entries, { id: nextReferenceId(block.entries), text: '' }],
                })
              }
            >
              {text.addReference}
            </button>
          </div>
        </div>
      );
  }
}
