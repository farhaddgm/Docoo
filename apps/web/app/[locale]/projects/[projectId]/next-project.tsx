'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';

import { apiSend } from '../../../api-client';
import type { Locale } from '../../../i18n';
import { Notice, useAction } from '../../use-action';
import { explainProject } from '../explain';
import { projectMessages } from '../messages';
import type { ProjectDetail } from './project-types';
import { textDir } from '../../../i18n';

const copy = {
  fa: {
    title: 'ساخت پروژهٔ بعدی',
    help: 'پروژهٔ جدید به‌صورت پیش‌نویس و وابسته به این پروژه ساخته می‌شود؛ تنظیمات، موضوع‌ها و کسب‌وکار همین پروژه به آن منتقل می‌شود و پیش از فعال‌سازی می‌توانید همه‌چیز را بازبینی کنید.',
    open: 'ساخت پروژهٔ بعدی از این پروژه',
    kind: 'نوع پروژهٔ بعدی',
    continuation: 'ادامه: همان مسئله را با همین داده‌ها پیش می‌برد',
    pivot: 'Pivot: از این پروژه تأثیر می‌گیرد اما جهت تازه‌ای دارد',
    code: 'کد پروژهٔ جدید',
    name: 'عنوان پروژهٔ جدید',
    pivotProblem: 'جهت یا مسئلهٔ جدید',
    create: 'ساخت پیش‌نویس',
    cancel: 'انصراف',
    from: 'ساخته‌شده بر پایهٔ پروژهٔ',
    fromDimension: 'ساخته‌شده از بُعد',
    fromProblem: 'ساخته‌شده از مسئلهٔ',
    inExploration: 'در کاوش',
    kinds: { copy: 'کپی', continuation: 'ادامه', pivot: 'Pivot' },
  },
  en: {
    title: 'Build the next project',
    help: 'The new project is created as a draft linked to this one. It takes over this project’s settings, topics and business, and you can review everything before activating it.',
    open: 'Build the next project from this one',
    kind: 'Kind of next project',
    continuation: 'Continuation: carries on with the same problem and this data',
    pivot: 'Pivot: drawn from this project but heading a new way',
    code: 'New project code',
    name: 'New project title',
    pivotProblem: 'New direction or problem',
    create: 'Create the draft',
    cancel: 'Cancel',
    from: 'Built on project',
    fromDimension: 'Made from the dimension',
    fromProblem: 'Made from the problem',
    inExploration: 'in the exploration',
    kinds: { copy: 'Copy', continuation: 'Continuation', pivot: 'Pivot' },
  },
} as const;

export function originLabel(locale: Locale, project: ProjectDetail): string | null {
  if (!project.clonedFromId || !project.originKind) return null;
  return copy[locale].kinds[project.originKind];
}

/** Offered on a completed project: a continuation or a pivot, created as a linked draft. */
export function NextProjectCard({
  locale,
  workspaceId,
  project,
}: {
  locale: Locale;
  workspaceId: string;
  project: ProjectDetail;
}) {
  const text = copy[locale];
  const formText = projectMessages(locale);
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'continuation' | 'pivot'>('continuation');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState(project.title);
  const [pivotProblem, setPivotProblem] = useState('');
  const explain = useCallback((error: unknown) => explainProject(error, formText), [formText]);
  const { busy, notice, run } = useAction(explain);
  const valid = code.trim() !== '' && (kind === 'continuation' || pivotProblem.trim() !== '');

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.title}</h2>
      <p className="muted">{text.help}</p>
      <Notice notice={notice} />
      {!open ? (
        <div className="toolbar">
          <button
            data-write-action
            className="primary-button"
            type="button"
            onClick={() => setOpen(true)}
          >
            {text.open}
          </button>
        </div>
      ) : (
        <form
          className="field-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void run(async () => {
              const result = await apiSend<{ project: ProjectDetail }>(
                'POST',
                `/workspaces/${workspaceId}/projects/${project.id}/clone`,
                {
                  code: code.trim(),
                  ...(title.trim() ? { title: title.trim() } : {}),
                  kind,
                  ...(kind === 'pivot' ? { pivotProblem: pivotProblem.trim() } : {}),
                },
              );
              router.push(`/${locale}/projects/${result.project.id}` as Route);
            }, '');
          }}
        >
          <fieldset>
            <legend>{text.kind}</legend>
            {(['continuation', 'pivot'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />{' '}
                {text[value]}
              </label>
            ))}
          </fieldset>
          <label htmlFor={`${id}-code`}>{text.code}</label>
          <input
            id={`${id}-code`}
            dir="ltr"
            maxLength={64}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <label htmlFor={`${id}-name`}>{text.name}</label>
          <input
            id={`${id}-name`}
            dir={textDir(locale)}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {kind === 'pivot' && (
            <>
              <label htmlFor={`${id}-pivot`}>{text.pivotProblem}</label>
              <textarea
                id={`${id}-pivot`}
                dir={textDir(locale)}
                rows={4}
                maxLength={8000}
                value={pivotProblem}
                onChange={(event) => setPivotProblem(event.target.value)}
              />
            </>
          )}
          <div className="toolbar">
            <button className="primary-button" type="submit" disabled={busy || !valid}>
              {text.create}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** A link to the project this one was built on, with how it began. */
export function OriginNote({ locale, project }: { locale: Locale; project: ProjectDetail }) {
  const label = originLabel(locale, project);
  if (!label || !project.clonedFromId) return null;
  return (
    <p className="muted">
      {copy[locale].from}{' '}
      <Link href={`/${locale}/projects/${project.clonedFromId}` as Route}>{label}</Link>
    </p>
  );
}

/** A link back to the candidate problem of an exploration this project was made from (ADR-0044). */
export function ExplorationOriginNote({
  locale,
  project,
}: {
  locale: Locale;
  project: ProjectDetail;
}) {
  const origin = project.explorationOrigin;
  const text = copy[locale];
  const dimension = project.dimensionOrigin;
  if (dimension) {
    return (
      <p className="muted">
        {text.fromDimension}{' '}
        <strong dir={textDir(locale)}>{dimension.dimensionTitle ?? dimension.solutionId}</strong>{' '}
        {text.inExploration}{' '}
        <Link href={`/${locale}/projects/${dimension.projectId}` as Route}>
          <span dir={textDir(locale)}>{dimension.projectTitle ?? dimension.projectId}</span>
        </Link>
      </p>
    );
  }
  if (!origin) return null;
  return (
    <p className="muted">
      {text.fromProblem}{' '}
      <strong dir={textDir(locale)}>{origin.candidateTitle ?? origin.candidateKey}</strong>{' '}
      {text.inExploration}{' '}
      <span dir={textDir(locale)}>{origin.explorationTitle ?? origin.explorationId}</span>
    </p>
  );
}
