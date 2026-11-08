'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { apiGet } from '../../../api-client';
import { formatDateTime, formatNumber, messagesFor, textDir, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { digestOutput, pickOutput } from './output-digest';
import { workflowMessages } from './workflow-messages';
import { TextSkeleton } from '../../../skeleton';

interface OutputRow {
  id: string;
  versionNo: number;
  content: unknown;
  origin: string;
  current: boolean;
  createdAt: string;
}

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; output: OutputRow | null };

/**
 * The popup of the workflow's "view output" button: a short reading of the latest output of one
 * stage, in the middle of the page. The full output stays in the stage's own tab, one button away.
 */
export function StageOutputDialog({
  locale,
  base,
  stage,
  onClose,
  onOpenStage,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  stage: { id: string; stage: string; latestOutputId?: string | null };
  onClose: () => void;
  onOpenStage: (stage: string) => void;
}) {
  const text = workflowMessages(locale);
  const common = reportMessagesFor(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Bumped by "Try again" to read the output once more.
  const [attempt, setAttempt] = useState(0);
  const stageName = text.stages[stage.stage] ?? stage.stage;
  const latestOutputId = stage.latestOutputId ?? null;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    setLoad({ kind: 'loading' });
    apiGet<{ stage: { outputs: OutputRow[] } }>(`${base}/stages/${stage.id}`)
      .then(({ stage: detail }) => {
        if (active) setLoad({ kind: 'ready', output: pickOutput(detail.outputs, latestOutputId) });
      })
      .catch(() => {
        if (active) setLoad({ kind: 'failed' });
      });
    return () => {
      active = false;
    };
  }, [base, stage.id, latestOutputId, attempt]);

  /** A click on the dimmed area closes the popup; one that ends inside it (a text selection) does not. */
  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    const element = dialog.current;
    if (!element || event.target !== element) return;
    const box = element.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) element.close();
  }

  function openStageTab() {
    dialog.current?.close();
    onOpenStage(stage.stage);
  }

  const output = load.kind === 'ready' ? load.output : null;
  const blocks = output
    ? digestOutput(stage.stage, output.content, (value) => formatNumber(locale, value))
    : [];

  return (
    <dialog
      ref={dialog}
      className="business-dialog output-dialog"
      aria-labelledby="stage-output-title"
      onClose={onClose}
      onClick={closeOnBackdrop}
    >
      <div className="business-dialog-head">
        <h2 id="stage-output-title">{text.outputDialog.title.replace('{stage}', stageName)}</h2>
        <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>
          {text.outputDialog.close}
        </button>
      </div>

      {load.kind === 'loading' && <TextSkeleton label={common.loading} lines={5} />}
      {load.kind === 'failed' && (
        <div className="stack">
          <p className="notice error" role="alert">
            {common.loadFailed}
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {messagesFor(locale).retry}
            </button>
          </div>
        </div>
      )}
      {load.kind === 'ready' && !output && <p className="muted">{text.outputDialog.noOutput}</p>}
      {output && (
        <div className="stack">
          <p className="muted">
            {text.outputVersion.replace('{n}', formatNumber(locale, output.versionNo))} ·{' '}
            {text.outputOrigin[output.origin] ?? output.origin} ·{' '}
            {formatDateTime(locale, output.createdAt)}
          </p>
          <p>{text.outputDialog.intro}</p>
          {blocks.length === 0 ? (
            <p className="muted">{text.outputDialog.noDigest}</p>
          ) : (
            <div className="output-view">
              {blocks.map((block) => (
                <section key={block.key}>
                  <h4>{text.out[block.key]}</h4>
                  {block.text !== undefined && <p dir={textDir(locale)}>{block.text}</p>}
                  {block.items && (
                    <>
                      <ul>
                        {block.items.map((item, index) => (
                          <li key={index} dir={textDir(locale)}>
                            {item}
                          </li>
                        ))}
                      </ul>
                      {(block.total ?? 0) > block.items.length && (
                        <p className="muted">
                          {text.outputDialog.more.replace(
                            '{n}',
                            formatNumber(locale, (block.total ?? 0) - block.items.length),
                          )}
                        </p>
                      )}
                    </>
                  )}
                </section>
              ))}
            </div>
          )}
          <div className="toolbar">
            <button type="button" className="primary-button" onClick={openStageTab}>
              {text.viewOutput.replace('{stage}', stageName)}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
