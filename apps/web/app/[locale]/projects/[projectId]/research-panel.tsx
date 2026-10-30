'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { ResearchConflictsPanel } from './research-conflicts-panel';
import { ResearchFollowupPanel } from './research-followup-panel';
import { ResearchPlanPanel } from './research-plan-panel';
import { StageOutput } from './stage-output';
import { workflowMessages } from './workflow-messages';

interface StageItem {
  id: string | null;
  stage: string;
  status: string;
  pendingGateOutputId?: string | null;
}

interface Output {
  id: string;
  versionNo: number;
  content: unknown;
  origin: string;
  current: boolean;
  createdAt: string;
}

const copy = {
  fa: {
    title: 'تحقیق',
    help: 'نتیجهٔ مرحلهٔ تحقیق: خلاصه، یافته‌ها زیر هر پرسش برنامه، منابع و جست‌وجوی وب. تأیید یا رد خروجی در تب «گردش‌کار» انجام می‌شود.',
    empty:
      'هنوز مرحلهٔ تحقیق خروجی نداده است. بعد از تکمیل تحلیل، گردش‌کار این مرحله را اجرا می‌کند.',
    waiting: 'این خروجی منتظر تأیید شماست.',
    openWorkflow: 'رفتن به گردش‌کار',
    refresh: 'تازه‌سازی',
    version: 'نسخهٔ {n}',
  },
  en: {
    title: 'Research',
    help: 'The result of the research stage: sources, findings and web search. Approving or rejecting the output is done in the Workflow tab.',
    empty:
      'The research stage has not produced an output yet. The workflow runs it once the analysis is complete.',
    waiting: 'This output is waiting for your approval.',
    openWorkflow: 'Go to the workflow',
    refresh: 'Refresh',
    version: 'Version {n}',
  },
};

/** The research stage on its own: its latest output, read-only (decisions stay in the workflow). */
export function ResearchPanel({
  locale,
  workspaceId,
  projectId,
  refreshKey,
  onOpenWorkflow,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  refreshKey: number;
  onOpenWorkflow: () => void;
  /** Called after the research plan is confirmed, so the other tabs follow. */
  onChanged: () => void;
}) {
  const text = copy[locale === 'fa' ? 'fa' : 'en'];
  const wf = workflowMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [stage, setStage] = useState<StageItem | null | undefined>(undefined);
  const [output, setOutput] = useState<Output | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped when a question is added to the plan from the follow-up card, so the plan card reloads.
  const [planTick, setPlanTick] = useState(0);

  const load = useCallback(async () => {
    const { workflow } = await apiGet<{ workflow: { stages: StageItem[] } }>(`${base}/workflow`);
    const found = workflow.stages.find((item) => item.stage === 'research') ?? null;
    setStage(found);
    if (!found?.id) {
      setOutput(null);
      return;
    }
    const { stage: detail } = await apiGet<{ stage: { outputs: Output[] } }>(
      `${base}/stages/${found.id}`,
    );
    const outputs = [...detail.outputs].sort((a, b) => b.versionNo - a.versionNo);
    setOutput(outputs.find((item) => item.current) ?? outputs[0] ?? null);
  }, [base]);

  useEffect(() => {
    setFailed(false);
    load().catch(() => setFailed(true));
  }, [load, refreshKey]);

  if (failed) {
    return (
      <p className="notice error" role="alert">
        {common.loadFailed}
      </p>
    );
  }
  if (stage === undefined) return <p role="status">{common.loading}</p>;

  return (
    <div className="stack">
      <ResearchPlanPanel
        locale={locale}
        base={base}
        refreshKey={refreshKey + planTick}
        onChanged={onChanged}
      />
      {output && (
        <ResearchConflictsPanel locale={locale} base={base} refreshKey={refreshKey + planTick} />
      )}
      {output && (
        <ResearchFollowupPanel
          locale={locale}
          base={base}
          refreshKey={refreshKey + planTick}
          onChanged={onChanged}
          onPlanChanged={() => setPlanTick((tick) => tick + 1)}
        />
      )}
      <section className="card" aria-labelledby="research-title">
        <div className="toolbar spread">
          <h2 id="research-title">{text.title}</h2>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load().catch(() => setFailed(true))}
          >
            {text.refresh}
          </button>
        </div>
        <p className="muted">{text.help}</p>
        {stage && (
          <p>
            <span className={`badge state-${stage.status}`}>
              {wf.stageStatuses[stage.status] ?? stage.status}
            </span>
          </p>
        )}
        {!output ? (
          <p className="muted">{text.empty}</p>
        ) : (
          <>
            <p className="muted">
              {text.version.replace('{n}', formatNumber(locale, output.versionNo))} ·{' '}
              {wf.outputOrigin[output.origin] ?? output.origin} ·{' '}
              {formatDateTime(locale, output.createdAt)}
            </p>
            {stage?.pendingGateOutputId === output.id && (
              <p className="notice" role="status">
                {text.waiting}{' '}
                <button type="button" className="link-button" onClick={onOpenWorkflow}>
                  {text.openWorkflow}
                </button>
              </p>
            )}
            <StageOutput locale={locale} stage="research" content={output.content} />
          </>
        )}
      </section>
    </div>
  );
}
