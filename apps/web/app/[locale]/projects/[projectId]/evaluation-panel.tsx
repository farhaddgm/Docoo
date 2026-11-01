'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { RequirementCoverage } from './requirements-panel';
import { StageAgentChat } from './stage-chat';
import { StageOutput } from './stage-output';
import { workflowMessages } from './workflow-messages';

interface StageItem {
  id: string | null;
  stage: string;
  status: string;
  gateMode?: string;
  attemptLimit?: number;
  attemptsUsed?: number;
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
    title: 'ارزیابی',
    help: 'نتیجه مرحله ارزیابی: امتیاز هر معیار، شواهد و جمع‌بندی. تأیید یا رد خروجی در تب «گردش‌کار» انجام می‌شود.',
    empty:
      'هنوز مرحله ارزیابی خروجی نداده است. بعد از مستندسازی، گردش‌کار این مرحله را اجرا می‌کند.',
    waiting: 'این خروجی منتظر تأیید شماست.',
    openWorkflow: 'رفتن به گردش‌کار',
    refresh: 'تازه‌سازی',
    version: 'نسخه {n}',
    settings: 'تنظیمات مرحله',
    gate: 'نوع تأیید',
    gateManual: 'تأیید دستی',
    gateAutomatic: 'تأیید خودکار',
    attempts: 'تلاش‌ها',
    attemptsValue: '{used} از {limit}',
    openSettings: 'تنظیمات پروژه',
    openLab: 'مقایسه کیفیت ایجنت‌ها',
  },
  en: {
    title: 'Evaluation',
    help: 'The result of the evaluation stage: a score and evidence per criterion, and a summary. Approving or rejecting the output is done in the Workflow tab.',
    empty:
      'The evaluation stage has not produced an output yet. The workflow runs it once the documentation is done.',
    waiting: 'This output is waiting for your approval.',
    openWorkflow: 'Go to the workflow',
    refresh: 'Refresh',
    version: 'Version {n}',
    settings: 'Stage settings',
    gate: 'Approval',
    gateManual: 'Manual approval',
    gateAutomatic: 'Automatic approval',
    attempts: 'Attempts',
    attemptsValue: '{used} of {limit}',
    openSettings: 'Project settings',
    openLab: 'Compare agent quality',
  },
};

/** The evaluation stage on its own: its output, its settings and the conversation with its agent. */
export function EvaluationPanel({
  locale,
  workspaceId,
  projectId,
  refreshKey,
  onOpenWorkflow,
  onOpenSettings,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  refreshKey: number;
  onOpenWorkflow: () => void;
  onOpenSettings: () => void;
  onChanged: () => void;
}) {
  const text = copy[locale === 'fa' ? 'fa' : 'en'];
  const wf = workflowMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [stage, setStage] = useState<StageItem | null | undefined>(undefined);
  const [output, setOutput] = useState<Output | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { workflow } = await apiGet<{ workflow: { stages: StageItem[] } }>(`${base}/workflow`);
    const found = workflow.stages.find((item) => item.stage === 'evaluation') ?? null;
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
      <section className="card stack" aria-labelledby="evaluation-title">
        <div className="toolbar spread">
          <h2 id="evaluation-title">{text.title}</h2>
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
            <StageOutput locale={locale} stage="evaluation" content={output.content} />
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="evaluation-settings">
        <h3 id="evaluation-settings">{text.settings}</h3>
        <dl className="business-facts">
          {stage?.gateMode && (
            <div>
              <dt>{text.gate}</dt>
              <dd>{stage.gateMode === 'manual' ? text.gateManual : text.gateAutomatic}</dd>
            </div>
          )}
          {stage?.attemptsUsed !== undefined && stage.attemptLimit !== undefined && (
            <div>
              <dt>{text.attempts}</dt>
              <dd>
                {text.attemptsValue
                  .replace('{used}', formatNumber(locale, stage.attemptsUsed))
                  .replace('{limit}', formatNumber(locale, stage.attemptLimit))}
              </dd>
            </div>
          )}
        </dl>
        <div className="toolbar">
          <button type="button" className="secondary-button" onClick={onOpenSettings}>
            {text.openSettings}
          </button>
          <a
            className="secondary-button link-button"
            href={`/${locale}/projects/${projectId}/evaluation-lab?workspaceId=${workspaceId}`}
          >
            {text.openLab}
          </a>
        </div>
      </section>

      <RequirementCoverage locale={locale} base={base} refreshKey={refreshKey} />

      <StageAgentChat
        locale={locale}
        base={base}
        stage="evaluation"
        refreshKey={refreshKey}
        onChanged={onChanged}
      />
    </div>
  );
}
