'use client';

import { useId, useRef, type ReactNode } from 'react';

import { formatNumber, type Locale } from '../../../i18n';
import { problemMessages } from './problem-messages';
import { answerModes, type Attachment, type Draft, type Question } from './problem-types';
import { ACCEPTED_EXTENSIONS } from './upload-file';

export function draftOf(question: Question): Draft {
  const answer = question.answer;
  return {
    mode: question.status === 'open' ? null : question.status,
    text: answer?.text ?? '',
    files: answer?.attachments ?? [],
    uploading: false,
  };
}

/** A draft that would be rejected: "I answer" needs text or a file. */
export function draftProblem(draft: Draft): 'needAnswer' | null {
  return draft.mode === 'answered' && draft.text.trim() === '' && draft.files.length === 0
    ? 'needAnswer'
    : null;
}

/**
 * One question with its answer controls (FR-ANL-003): text, files, or one of the three
 * statuses. Native radios and fields keep it operable by keyboard and screen readers.
 */
export function QuestionEditor({
  locale,
  anchor,
  question,
  draft,
  showProblem,
  disabled,
  patch,
  onEdit,
  onStopEditing,
  onUpload,
  footer = null,
}: {
  locale: Locale;
  /** Prefix of the element id, so a question shown in two lists never repeats an id. */
  anchor: string;
  question: Question;
  /** Undefined while the question shows its saved answer and is not being edited. */
  draft: Draft | undefined;
  showProblem: boolean;
  disabled: boolean;
  /** Applies a change to the latest draft, so a finished upload never overwrites typing. */
  patch: (change: (draft: Draft) => Draft) => void;
  onEdit: () => void;
  onStopEditing: () => void;
  onUpload: (file: File) => Promise<Attachment>;
  /** Extra controls under the question, such as a button that saves only this one. */
  footer?: ReactNode;
}) {
  const text = problemMessages(locale);
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const heading = `${id}-heading`;
  const label = text.questionLabel.replace('{n}', formatNumber(locale, question.number));
  const title = (
    <h4 id={heading}>
      {label}{' '}
      <span className="badge">{text.categories[question.category] ?? question.category}</span>
    </h4>
  );

  if (draft === undefined) {
    const saved = question.status === 'open' ? null : question.status;
    return (
      <li className="question" id={`${anchor}-question-${question.number}`}>
        {title}
        <p className="question-text" dir="auto">
          {question.text}
        </p>
        {saved && (
          <p>
            <span className={`badge answer-${saved}`}>
              {text.savedAs.replace('{mode}', text.modes[saved] ?? saved)}
            </span>
            {question.answer?.text && (
              <span className="answer-text" dir="auto">
                {' '}
                {question.answer.text}
              </span>
            )}
          </p>
        )}
        {question.answer && question.answer.attachments.length > 0 && (
          <ul className="plain-list" aria-label={text.files}>
            {question.answer.attachments.map((file) => (
              <li key={file.sourceId} dir="auto">
                {text.attachmentLabel}: {file.title}
              </li>
            ))}
          </ul>
        )}
        {!disabled && (
          <button
            type="button"
            className="secondary-button"
            aria-describedby={heading}
            onClick={onEdit}
          >
            {text.editAnswer}
          </button>
        )}
        {footer}
      </li>
    );
  }

  const problem = showProblem ? draftProblem(draft) : null;
  const noteOnly =
    draft.mode === 'later' || draft.mode === 'irrelevant' || draft.mode === 'unanswered';

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    patch((current) => ({ ...current, mode: 'answered', uploading: true }));
    onUpload(file).then(
      (attachment) =>
        patch((current) => ({
          ...current,
          mode: 'answered',
          files: [...current.files, attachment],
          uploading: false,
        })),
      () => patch((current) => ({ ...current, uploading: false })),
    );
    if (picker.current) picker.current.value = '';
  }

  return (
    <li className="question" id={`${anchor}-question-${question.number}`}>
      {title}
      <p className="question-text" dir="auto">
        {question.text}
      </p>
      {question.followUpOf !== null && (
        <p className="muted">
          {text.followUpOf.replace('{n}', formatNumber(locale, question.followUpOf))}
        </p>
      )}
      {question.rationale && (
        <details>
          <summary>{text.why}</summary>
          <p dir="auto">{question.rationale}</p>
        </details>
      )}
      <div className="field-stack">
        <div role="radiogroup" aria-labelledby={heading} className="mode-choice">
          {answerModes.map((mode) => (
            <label key={mode} className={`mode mode-${mode}`}>
              <input
                type="radio"
                name={`${id}-mode`}
                value={mode}
                checked={draft.mode === mode}
                disabled={disabled}
                onChange={() => patch((current) => ({ ...current, mode }))}
              />{' '}
              {text.modes[mode]}
            </label>
          ))}
        </div>
        <label htmlFor={`${id}-text`}>{noteOnly ? text.noteLabel : text.answerLabel}</label>
        <textarea
          id={`${id}-text`}
          rows={3}
          dir="auto"
          maxLength={8000}
          value={draft.text}
          disabled={disabled}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => {
            const value = event.target.value;
            patch((current) => ({
              ...current,
              text: value,
              // Typing an answer is the choice "I answer" unless another status was picked.
              mode: current.mode ?? (value.trim() ? 'answered' : null),
            }));
          }}
        />
        {!noteOnly && (
          <div className="file-pick">
            <label htmlFor={`${id}-file`}>{text.attach}</label>
            <input
              ref={picker}
              id={`${id}-file`}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              disabled={disabled || draft.uploading}
              aria-describedby={`${id}-file-help`}
              onChange={(event) => pick(event.target.files)}
            />
            <small
              id={`${id}-file-help`}
              className="muted"
              role={draft.uploading ? 'status' : undefined}
            >
              {draft.uploading ? text.uploading : text.attachHelp}
            </small>
          </div>
        )}
        {draft.files.length > 0 && (
          <ul className="plain-list" aria-label={text.files}>
            {draft.files.map((file) => (
              <li key={file.sourceId}>
                <span dir="auto">{file.title}</span>{' '}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  aria-label={text.removeFile.replace('{name}', file.title)}
                  onClick={() =>
                    patch((current) => ({
                      ...current,
                      files: current.files.filter((item) => item.sourceId !== file.sourceId),
                    }))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {problem && (
          <p id={`${id}-problem`} className="field-error" role="alert">
            {text.needAnswer}
          </p>
        )}
        {question.status !== 'open' && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={onStopEditing}
          >
            {text.cancelEdit}
          </button>
        )}
        {footer}
      </div>
    </li>
  );
}
