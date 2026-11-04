import type { ProjectCommand } from '@docoo/domain';
import { z } from 'zod';

import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProjectReportService } from '../projects/project-report.service.js';
import type { ProjectsService } from '../projects/projects.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import { defineCapability, type LiveCapability, type LiveLocale } from './capabilities.js';
import { CAPABILITY_TOOLS } from './capability-tools.js';

/**
 * The capabilities of the live assistant about projects (ADR-0055 §4-3): look at them, read one in
 * depth, and move one through its life (pause, resume, complete, archive, delete and their
 * undos). They call the same services as the back office screens, as the administrator, so a
 * change made by voice has the same rules, the same audit trail and the same side effects (the
 * workflow follows the project) as one made with a click.
 *
 * Risk follows what the change costs or undoes: pausing, archiving and their undos are reversible
 * (T1); resuming starts model work again and completing ends the project's work (T2); deleting is
 * irreversible after 30 days and is off until the owner switches its category on (T3, confirmed
 * twice, the second time by the project's name).
 *
 * Reads that return long-form content are marked untrusted: what a problem statement or an output
 * says may be written to steer the assistant, so the session's later changes are confirmed more
 * strictly for a while.
 */

const projectId = z.uuid().transform((value) => value.toLowerCase());
const reason = z.string().trim().min(1).max(300);

const t = (locale: LiveLocale, fa: string, en: string): string => (locale === 'fa' ? fa : en);

interface ProjectFacts {
  readonly title: string;
  readonly code: string;
  readonly status: string;
}

const label = (facts: ProjectFacts | undefined, id: string): string =>
  facts ? `«${facts.title}» (${facts.code})` : id;

/** What a voice change writes in the project's history, so a person can tell where it came from. */
const reasonOf = (text: string | undefined, fallback: string): string =>
  `Voice assistant: ${text ?? fallback}`;

const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

type Context = Parameters<ProjectsService['get']>[0];
type Report = Awaited<ReturnType<ProjectReportService['report']>>;

/**
 * The report cut down to what a conversation needs: the problem, the totals, the ideas and the
 * final outputs, each bounded, so one answer cannot flood the model or the ledger.
 */
export function compactReport(report: Report) {
  return {
    project: {
      id: report.project.id,
      code: report.project.code,
      title: report.project.title,
      status: report.project.status,
      stage: report.project.currentStage,
      kind: report.project.kind,
      language: report.project.outputLanguage,
      updatedAt: report.project.updatedAt,
    },
    problem: {
      initialProblem: clip(report.problem.initialProblem, 4000),
      description: clip(report.problem.description, 2000),
      expectedOutput: clip(report.problem.expectedOutput, 2000),
      approvedStatement: report.problem.approvedStatement
        ? clip(report.problem.approvedStatement, 4000)
        : null,
    },
    usage: {
      invocations: report.usage.totals.invocations,
      inputTokens: report.usage.totals.inputTokens,
      outputTokens: report.usage.totals.outputTokens,
      costUsd: report.usage.totals.costUsd,
      failures: report.usage.totals.failures,
    },
    ideas: {
      total: report.ideas.items.length,
      items: report.ideas.items.slice(0, 10).map((idea) => ({
        title: clip(idea.title, 200),
        summary: clip(idea.summary, 600),
        score: idea.score,
        chosenPriority: idea.selectedPriority,
      })),
    },
    outputs: {
      inProgress: report.outputs.inProgress,
      final: report.outputs.items.slice(0, 20).map((output) => ({
        title: clip(output.title, 200),
        status: output.status,
        language: output.language,
        version: output.versionNo,
        formats: output.artifacts.map((artifact) => artifact.format),
      })),
    },
  };
}

export function projectCapabilities(services: {
  readonly projects: ProjectsService;
  readonly reports: ProjectReportService;
  readonly notifications: NotificationsService;
  readonly workflow: WorkflowService;
}): LiveCapability[] {
  const { projects, reports, notifications, workflow } = services;

  const facts = async (context: Context, id: string): Promise<ProjectFacts> => {
    const project = await projects.get(context, id);
    return { title: project.title, code: project.code, status: project.status };
  };

  const overview = defineCapability({
    meta: { name: 'projects.overview', klass: 'T0', area: 'projects_overview', write: false },
    tool: CAPABILITY_TOOLS['projects.overview'],
    params: z.object({
      q: z.string().trim().max(100).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    describe: (params, locale) => ({
      summary: params.q
        ? t(
            locale,
            `فهرست پروژه‌ها (جست‌وجوی «${params.q}»)`,
            `Project list (search "${params.q}")`,
          )
        : t(locale, 'فهرست پروژه‌ها', 'Project list'),
    }),
    execute: async ({ context }, params) => {
      const page = await projects.list(context, {
        limit: params.limit,
        status: 'current',
        ...(params.q ? { q: params.q } : {}),
      });
      return {
        projects: page.items.map((item) => ({
          id: item.id,
          code: item.code,
          title: item.title,
          status: item.status,
          stage: item.currentStage,
          waitingForYou: item.waiting !== null,
        })),
        more: page.nextCursor !== null,
      };
    },
  });

  const waiting = defineCapability({
    meta: { name: 'projects.waiting', klass: 'T0', area: 'projects_overview', write: false },
    tool: CAPABILITY_TOOLS['projects.waiting'],
    params: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
    describe: (_params, locale) => ({
      summary: t(
        locale,
        'پروژه‌هایی که منتظر تصمیم شما هستند',
        'Projects waiting for your decision',
      ),
    }),
    execute: async ({ context }, params) => {
      const page = await projects.list(context, {
        limit: params.limit,
        status: 'current',
        waiting: true,
      });
      return {
        projects: page.items.map((item) => ({
          id: item.id,
          code: item.code,
          title: item.title,
          status: item.status,
          stage: item.currentStage,
          waitingFor: item.waiting?.kind ?? null,
          waitingStage: item.waiting?.stage ?? null,
        })),
        more: page.nextCursor !== null,
      };
    },
  });

  // Notifications belong to the whole back office, not to one project: they are within reach only
  // when the owner gave the assistant the back office, not just the projects.
  const unread = defineCapability({
    meta: { name: 'notifications.unread', klass: 'T0', area: 'backoffice', write: false },
    tool: CAPABILITY_TOOLS['notifications.unread'],
    params: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
    describe: (_params, locale) => ({
      summary: t(locale, 'اعلان‌های خواندنی‌نشده', 'Unread notifications'),
    }),
    execute: async ({ context }, params) => {
      const [summary, page] = await Promise.all([
        notifications.summary(context),
        notifications.list(context, { status: 'unread', limit: params.limit }),
      ]);
      return {
        unread: summary.unread,
        // What happened and where, never the payload: it can hold free text.
        items: page.items.map((item) => ({
          kind: item.kind,
          project: item.project,
          stillWaiting: item.stillWaiting,
          createdAt: item.createdAt,
        })),
      };
    },
  });

  const rename = defineCapability<{ projectId: string; title: string }, ProjectFacts>({
    meta: { name: 'project.rename', klass: 'T1', area: 'project', write: true },
    tool: CAPABILITY_TOOLS['project.rename'],
    params: z.object({ projectId, title: z.string().trim().min(1).max(200) }),
    projectOf: (params) => params.projectId,
    prepare: (context, params) => facts(context, params.projectId),
    describe: (params, locale, found) => ({
      summary: t(
        locale,
        `تغییر نام پروژهٔ ${label(found, params.projectId)} به «${params.title}»`,
        `Rename project ${label(found, params.projectId)} to "${params.title}"`,
      ),
    }),
    // The old title goes into the ledger with the result, so the change can be undone by hand.
    execute: async ({ context }, params) => {
      const current = await projects.get(context, params.projectId);
      const updated = await projects.update(context, params.projectId, current.version, {
        title: params.title,
        reason: reasonOf(undefined, 'renamed'),
      });
      return { id: updated.id, from: current.title, to: updated.title, version: updated.version };
    },
  });

  const status = defineCapability<{ projectId: string }, ProjectFacts>({
    meta: { name: 'project.status', klass: 'T0', area: 'project', write: false },
    tool: CAPABILITY_TOOLS['project.status'],
    params: z.object({ projectId }),
    projectOf: (params) => params.projectId,
    prepare: (context, params) => facts(context, params.projectId),
    describe: (params, locale, found) => ({
      summary: t(
        locale,
        `وضعیت پروژهٔ ${label(found, params.projectId)}`,
        `Status of project ${label(found, params.projectId)}`,
      ),
    }),
    execute: async ({ context }, params) => {
      const project = await projects.get(context, params.projectId);
      return {
        id: project.id,
        code: project.code,
        title: project.title,
        status: project.status,
        stage: project.currentStage,
        pauseReason: project.pauseReason,
        nextAction: project.nextAction,
        availableCommands: project.availableCommands,
        updatedAt: project.updatedAt,
      };
    },
  });

  const report = defineCapability<{ projectId: string }, ProjectFacts>({
    meta: { name: 'project.report', klass: 'T0', area: 'project', write: false },
    tool: CAPABILITY_TOOLS['project.report'],
    params: z.object({ projectId }),
    projectOf: (params) => params.projectId,
    prepare: (context, params) => facts(context, params.projectId),
    describe: (params, locale, found) => ({
      summary: t(
        locale,
        `گزارش پروژهٔ ${label(found, params.projectId)}: مسئله، مصرف، ایده‌ها و خروجی‌ها`,
        `Report of project ${label(found, params.projectId)}: problem, usage, ideas and outputs`,
      ),
    }),
    execute: async ({ context }, params) =>
      compactReport(await reports.report(context, params.projectId)),
    untrustedOutput: true,
  });

  /** A lifecycle command as the back office runs it: read the version, apply it, follow with the workflow. */
  const command =
    (name: ProjectCommand, fallback: string) =>
    async (
      { context }: { context: Context },
      params: { projectId: string; reason?: string | undefined },
    ) => {
      const current = await projects.get(context, params.projectId);
      const project = await projects.command(context, params.projectId, name, {
        expectedVersion: current.version,
        reason: reasonOf(params.reason, fallback),
      });
      await workflow.onProjectCommand(context, params.projectId, name);
      return { id: project.id, status: project.status, version: project.version };
    };

  /** A lifecycle capability: its risk, whether it needs a reason, and what it says before it runs. */
  const lifecycle = (
    name: ProjectCommand,
    klass: 'T1' | 'T2' | 'T3',
    options: {
      readonly needsReason: boolean;
      readonly fallback: string;
      readonly say: (locale: LiveLocale, who: string, why: string | undefined) => string;
    },
  ): LiveCapability => {
    const params = z.object({
      projectId,
      reason: options.needsReason ? reason : reason.optional(),
    });
    return defineCapability<{ projectId: string; reason?: string | undefined }, ProjectFacts>({
      meta: {
        name: `project.${name}`,
        klass,
        area: 'project',
        write: true,
        ...(klass === 'T3' ? { t3Category: 'delete' as const } : {}),
      },
      tool: CAPABILITY_TOOLS[`project.${name}`],
      params,
      projectOf: (value) => value.projectId,
      prepare: (context, value) => facts(context, value.projectId),
      describe: (value, locale, found) => ({
        summary: options.say(locale, label(found, value.projectId), value.reason),
        // An irreversible change is confirmed a second time by the name of the thing itself.
        ...(klass === 'T3' && found ? { targetName: found.title } : {}),
      }),
      execute: command(name, options.fallback),
    });
  };

  const why = (locale: LiveLocale, text: string | undefined): string =>
    text ? t(locale, ` — دلیل: ${text}`, ` — reason: ${text}`) : '';

  return [
    overview,
    waiting,
    unread,
    status,
    report,
    rename,
    lifecycle('pause', 'T1', {
      needsReason: true,
      fallback: 'paused',
      say: (locale, who, text) =>
        t(locale, `توقف پروژهٔ ${who}`, `Pause project ${who}`) + why(locale, text),
    }),
    // Starting the project's work again spends money, so it is a consequential change (T2): the
    // preview is read back before the confirmation.
    lifecycle('resume', 'T2', {
      needsReason: false,
      fallback: 'resumed',
      say: (locale, who) =>
        t(
          locale,
          `از سرگیری پروژهٔ ${who}؛ کار و هزینهٔ مدل‌ها دوباره شروع می‌شود`,
          `Resume project ${who}; work and model costs start again`,
        ),
    }),
    // A finished project's work starts again, with its model costs: consequential like a resume.
    lifecycle('reopen', 'T2', {
      needsReason: true,
      fallback: 'reopened',
      say: (locale, who, text) =>
        t(
          locale,
          `بازکردن دوبارهٔ پروژهٔ ${who}؛ کار و هزینهٔ مدل‌ها دوباره شروع می‌شود`,
          `Reopen project ${who}; work and model costs start again`,
        ) + why(locale, text),
    }),
    lifecycle('complete', 'T2', {
      needsReason: true,
      fallback: 'completed',
      say: (locale, who, text) =>
        t(
          locale,
          `پایان‌دادن به پروژهٔ ${who}؛ کار آن بسته می‌شود`,
          `Complete project ${who}; its work is closed`,
        ) + why(locale, text),
    }),
    lifecycle('archive', 'T1', {
      needsReason: false,
      fallback: 'archived',
      say: (locale, who, text) =>
        t(
          locale,
          `بایگانی پروژهٔ ${who}؛ فقط‌خواندنی می‌شود`,
          `Archive project ${who}; it becomes read-only`,
        ) + why(locale, text),
    }),
    lifecycle('unarchive', 'T1', {
      needsReason: false,
      fallback: 'unarchived',
      say: (locale, who) =>
        t(locale, `خارج‌کردن پروژهٔ ${who} از بایگانی`, `Unarchive project ${who}`),
    }),
    lifecycle('delete', 'T3', {
      needsReason: false,
      fallback: 'deleted',
      say: (locale, who, text) =>
        t(
          locale,
          `حذف پروژهٔ ${who}؛ فقط تا ۳۰ روز قابل بازیابی است`,
          `Delete project ${who}; recoverable for 30 days only`,
        ) + why(locale, text),
    }),
    lifecycle('restore', 'T1', {
      needsReason: false,
      fallback: 'restored',
      say: (locale, who) =>
        t(locale, `بازیابی پروژهٔ حذف‌شدهٔ ${who}`, `Restore the deleted project ${who}`),
    }),
  ];
}
