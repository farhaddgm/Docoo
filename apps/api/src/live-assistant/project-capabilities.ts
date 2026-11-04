import { z } from 'zod';

import type { ProjectsService } from '../projects/projects.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import { defineCapability, type LiveCapability, type LiveLocale } from './capabilities.js';

/**
 * The first capabilities of the live assistant (ADR-0055 §4-3): look at the projects, and pause or
 * resume one. They call the same services as the back office screens, as the administrator, so a
 * change made by voice has the same rules, the same audit trail and the same side effects (the
 * workflow follows the project) as one made with a click.
 *
 * Reads return a small, fixed set of fields (never the whole problem text); a later capability
 * reads content on purpose, within the owner's access scope.
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

export function projectCapabilities(services: {
  readonly projects: ProjectsService;
  readonly workflow: WorkflowService;
}): LiveCapability[] {
  const { projects, workflow } = services;

  const facts = async (
    context: Parameters<ProjectsService['get']>[0],
    id: string,
  ): Promise<ProjectFacts> => {
    const project = await projects.get(context, id);
    return { title: project.title, code: project.code, status: project.status };
  };

  const overview = defineCapability({
    meta: { name: 'projects.overview', klass: 'T0', area: 'projects_overview', write: false },
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

  const status = defineCapability<{ projectId: string }, ProjectFacts>({
    meta: { name: 'project.status', klass: 'T0', area: 'project', write: false },
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

  /** A lifecycle command as the back office runs it: read the version, apply it, follow with the workflow. */
  const command =
    (name: 'pause' | 'resume') =>
    async (
      { context }: { context: Parameters<ProjectsService['get']>[0] },
      params: { projectId: string; reason?: string | undefined },
    ) => {
      const current = await projects.get(context, params.projectId);
      const project = await projects.command(context, params.projectId, name, {
        expectedVersion: current.version,
        reason: reasonOf(params.reason, name === 'pause' ? 'paused' : 'resumed'),
      });
      await workflow.onProjectCommand(context, params.projectId, name);
      return { id: project.id, status: project.status, version: project.version };
    };

  const pause = defineCapability<{ projectId: string; reason: string }, ProjectFacts>({
    meta: { name: 'project.pause', klass: 'T1', area: 'project', write: true },
    params: z.object({ projectId, reason }),
    projectOf: (params) => params.projectId,
    prepare: (context, params) => facts(context, params.projectId),
    describe: (params, locale, found) => ({
      summary: t(
        locale,
        `توقف پروژهٔ ${label(found, params.projectId)} — دلیل: ${params.reason}`,
        `Pause project ${label(found, params.projectId)} — reason: ${params.reason}`,
      ),
    }),
    execute: command('pause'),
  });

  // Starting the project's work again spends money, so it is a consequential change (T2): the
  // preview is read back before the confirmation.
  const resume = defineCapability<{ projectId: string; reason?: string | undefined }, ProjectFacts>(
    {
      meta: { name: 'project.resume', klass: 'T2', area: 'project', write: true },
      params: z.object({ projectId, reason: reason.optional() }),
      projectOf: (params) => params.projectId,
      prepare: (context, params) => facts(context, params.projectId),
      describe: (params, locale, found) => ({
        summary: t(
          locale,
          `از سرگیری پروژهٔ ${label(found, params.projectId)}؛ کار و هزینهٔ مدل‌ها دوباره شروع می‌شود`,
          `Resume project ${label(found, params.projectId)}; work and model costs start again`,
        ),
      }),
      execute: command('resume'),
    },
  );

  return [overview, status, pause, resume];
}
