import {
  hasFillValue,
  liveNewProjectFillFields,
  liveNewProjectFillSchema,
  liveProjectTabs,
  liveScreenInstructionSchema,
  liveScreenPages,
  type LiveScreenInstruction,
} from '@docoo/contracts';
import { z } from 'zod';

import type { ProjectsService } from '../projects/projects.service.js';
import { defineCapability, type LiveCapability, type LiveLocale } from './capabilities.js';
import { CAPABILITY_TOOLS } from './capability-tools.js';

/**
 * What the live assistant shows on the screen (ADR-0055 §4-6): it opens a page for the owner and
 * puts a draft into the new-project form. Neither changes any data. They are reads in the gateway's
 * terms (tier T0), but they do nothing on the server: the result is an instruction for the
 * browser, which maps a page name to its own route and writes into the form's draft. The owner
 * reads the form and presses "Create" themselves. The ledger still records each one.
 */

const t = (locale: LiveLocale, fa: string, en: string): string => (locale === 'fa' ? fa : en);

const PAGE_FA: Record<(typeof liveScreenPages)[number], string> = {
  projects: 'فهرست پروژه‌ها',
  new_project: 'ساخت پروژهٔ تازه',
  project: 'صفحهٔ پروژه',
  knowledge: 'دانش',
  notifications: 'اعلان‌ها',
  costs: 'هزینه و مصرف',
  providers: 'ارائه‌دهندگان AI',
  topics: 'موضوع‌ها',
  explorations: 'کاوش‌ها',
  agents: 'عامل‌ها',
  brain: 'مغز',
  businesses: 'کسب‌وکارها',
  templates: 'قالب‌ها',
};
const PAGE_EN: Record<(typeof liveScreenPages)[number], string> = {
  projects: 'the project list',
  new_project: 'the new-project form',
  project: 'a project page',
  knowledge: 'knowledge',
  notifications: 'notifications',
  costs: 'costs and usage',
  providers: 'AI providers',
  topics: 'topics',
  explorations: 'explorations',
  agents: 'agents',
  brain: 'the brain',
  businesses: 'businesses',
  templates: 'templates',
};

/** What the owner calls each field of the new-project form. */
const FIELD_NAMES: Record<string, Record<LiveLocale, string>> = {
  title: { fa: 'عنوان', en: 'title' },
  description: { fa: 'شرح', en: 'description' },
  initialProblem: { fa: 'مسئله', en: 'problem' },
  expectedOutput: { fa: 'خروجی مورد انتظار', en: 'expected output' },
  code: { fa: 'کد', en: 'code' },
  outputLanguage: { fa: 'زبان خروجی', en: 'output language' },
};

const openParams = z
  .object({
    page: z.enum(liveScreenPages),
    projectId: z
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
    tab: z.enum(liveProjectTabs).optional(),
  })
  .superRefine((value, context) => {
    if (value.page === 'project' && value.projectId === undefined) {
      context.addIssue({ code: 'custom', path: ['projectId'], message: 'A project needs its id.' });
    }
    if (value.page !== 'project' && (value.projectId !== undefined || value.tab !== undefined)) {
      context.addIssue({ code: 'custom', message: 'Only a project page takes an id or a tab.' });
    }
  });

const fillParams = z
  .strictObject({ form: z.literal('new_project'), ...liveNewProjectFillFields.shape })
  .refine((value) => hasFillValue(fillValues(value)), { message: 'Give at least one value.' });

/** The values of a fill, without the name of the form. */
function fillValues(value: { form: string } & Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'form'));
}

/** The one place an instruction is built, and checked against the contract the browser reads. */
function instruction(value: unknown): LiveScreenInstruction {
  return liveScreenInstructionSchema.parse(value);
}

export function screenCapabilities(services: {
  readonly projects: ProjectsService;
}): LiveCapability[] {
  const { projects } = services;

  const open = defineCapability<z.infer<typeof openParams>, { title: string } | undefined>({
    meta: { name: 'screen.open', klass: 'T0', area: 'projects_overview', write: false },
    tool: CAPABILITY_TOOLS['screen.open'],
    params: openParams,
    // A page of a project that is not there is refused with its real reason, not shown empty.
    prepare: async (context, params) =>
      params.projectId
        ? { title: (await projects.get(context, params.projectId)).title }
        : undefined,
    describe: (params, locale, facts) => ({
      summary:
        params.page === 'project'
          ? t(
              locale,
              `باز کردن پروژهٔ «${facts?.title ?? params.projectId ?? ''}»${params.tab ? ` (بخش ${params.tab})` : ''}`,
              `Open project "${facts?.title ?? params.projectId ?? ''}"${params.tab ? ` (${params.tab} section)` : ''}`,
            )
          : t(locale, `باز کردن ${PAGE_FA[params.page]}`, `Open ${PAGE_EN[params.page]}`),
    }),
    execute: (_execution, params) =>
      Promise.resolve({
        screen: instruction({
          type: 'open',
          page: params.page,
          ...(params.projectId ? { projectId: params.projectId } : {}),
          ...(params.tab ? { tab: params.tab } : {}),
        }),
        shown: 'The page was opened on the owner’s screen.',
      }),
  });

  const fill = defineCapability<z.infer<typeof fillParams>>({
    meta: { name: 'screen.fill_form', klass: 'T0', area: 'projects_overview', write: false },
    tool: CAPABILITY_TOOLS['screen.fill_form'],
    params: fillParams,
    describe: (params, locale) => {
      // The owner reads the names of the fields in their own words, not the field keys.
      const names = Object.keys(fillValues(params))
        .map((key) => FIELD_NAMES[key]?.[locale] ?? key)
        .join(locale === 'fa' ? '، ' : ', ');
      return {
        summary: t(
          locale,
          `گذاشتن پیش‌نویس در فرم ساخت پروژه (${names})`,
          `Put a draft into the new-project form (${names})`,
        ),
      };
    },
    execute: (_execution, params) => {
      // The contract decides what is allowed in; anything else fails here and nothing is shown.
      const checked = liveNewProjectFillSchema.parse(fillValues(params));
      return Promise.resolve({
        screen: instruction({ type: 'fill', form: params.form, values: checked }),
        shown:
          'The values were put into the new-project form as a draft. It is not saved: the owner reads it and presses Create themselves.',
      });
    },
  });

  return [open, fill];
}
