'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import type { ProblemPatternDefinition } from '@docoo/contracts';
import { apiGet, apiSend } from '../../../api-client';
import type { Locale } from '../../../i18n';
import type { ProjectDetail } from './project-types';

export function PatternSelection({
  locale,
  workspaceId,
  project,
  readOnly,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  project: ProjectDetail;
  readOnly: boolean;
  onChanged: (project: ProjectDetail) => void;
}) {
  const fa = locale === 'fa';
  const [items, setItems] = useState<
    { id: string; patternId: string; version: number; definition: ProblemPatternDefinition }[]
  >([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const base = `/workspaces/${workspaceId}/projects`;
  useEffect(() => {
    if (readOnly || project.status !== 'draft') return;
    const controller = new AbortController();
    void apiGet<{ items: typeof items }>(`${base}/problem-pattern-versions`, controller.signal)
      .then(({ items: result }) => {
        setItems(result);
        setLoaded(true);
        setSelected(
          result.find(
            (item) =>
              item.patternId === project.problemPattern?.patternId &&
              item.version === project.problemPattern.version,
          )?.id ?? '',
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(fa ? 'بارگذاری الگوها کامل نشد.' : 'Could not load patterns.');
      });
    return () => controller.abort();
  }, [base, readOnly, project.status, project.problemPattern, fa]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await apiSend<{ project: ProjectDetail }>(
        'PUT',
        `${base}/${project.id}/problem-pattern`,
        { expectedVersion: project.version, versionId: selected || null },
      );
      onChanged(result.project);
    } catch {
      setError(
        fa
          ? 'تغییر الگو ممکن نشد؛ پس از شروع آمادگی یا اجرا، انتخاب قفل می‌شود.'
          : 'Could not change the pattern. Selection locks after preparation or execution starts.',
      );
    } finally {
      setBusy(false);
    }
  }
  const pattern = project.problemPattern;
  return (
    <section className="card">
      <h3>{fa ? 'الگوی اختیاری' : 'Optional pattern'}</h3>
      {pattern && (
        <>
          <p>
            {pattern.definition.title} · v{pattern.version}
          </p>
          <p>{pattern.definition.purpose}</p>
          {(pattern.definition.key === 'meeting' ||
            pattern.definition.stages.some((stage) => stage.activity === 'rehearse')) && (
            <Link
              href={`/${locale}/projects/${project.id}/meeting?workspaceId=${workspaceId}` as Route}
            >
              {fa ? 'آمادگی و تمرین جلسه' : 'Meeting preparation and practice'}
            </Link>
          )}
        </>
      )}
      {!readOnly && project.status === 'draft' && (
        <>
          <div className="pattern-select-row">
            <select
              aria-label={fa ? 'الگوی اختیاری' : 'Optional pattern'}
              value={selected}
              disabled={busy || !loaded}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">{fa ? 'بدون الگو' : 'No pattern'}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.definition.title} · v{item.version}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !loaded}
              onClick={() => void save()}
            >
              {fa ? 'ذخیرهٔ انتخاب الگو' : 'Save pattern selection'}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
