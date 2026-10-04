import type { Route } from 'next';

import type { Locale } from '../i18n';
import type { WalkerProgress, WalkerStep } from './api';

/**
 * Pages that serve a walker step; `null` means the page does not exist yet, so the step shows
 * guidance only. Steps of a project open that project's section (`?tab=`).
 */
const STEP_TARGETS: Readonly<
  Record<string, ((projectId: string | null) => string | null) | undefined>
> = {
  connect_provider: () => '/providers',
  create_topic: () => '/topics',
  create_project: () => '/projects/new',
  activate_project: (projectId) => (projectId ? `/projects/${projectId}` : '/projects'),
  complete_stages: (projectId) => (projectId ? `/projects/${projectId}?tab=workflow` : null),
  choose_solution: (projectId) => (projectId ? `/projects/${projectId}?tab=solutions` : null),
  evaluate_document: (projectId) => (projectId ? `/projects/${projectId}?tab=documents` : null),
  approve_document: (projectId) => (projectId ? `/projects/${projectId}?tab=documents` : null),
  review_brain: () => '/brain',
};

/** Localized path of the page that serves a step, or null while that page does not exist. */
export function stepHref(
  locale: Locale,
  key: string,
  projectId: string | null = null,
): Route | null {
  const route = STEP_TARGETS[key]?.(projectId);
  return route ? (`/${locale}${route}` as Route) : null;
}

/** The step the walker shows first: the suggested one, or the last step once all are done. */
export function defaultStepKey(progress: WalkerProgress): string | null {
  return progress.nextStep ?? progress.steps.at(-1)?.key ?? null;
}

export function stepByKey(progress: WalkerProgress, key: string | null): WalkerStep | null {
  return progress.steps.find((step) => step.key === key) ?? null;
}

/** Previous or next step relative to `key`; stays put at the ends. */
export function neighbourKey(
  progress: WalkerProgress,
  key: string | null,
  direction: -1 | 1,
): string | null {
  const index = progress.steps.findIndex((step) => step.key === key);
  const target = progress.steps[index + direction];
  return target?.key ?? key;
}

/** `/fa/projects/<uuid>/…` → the project id, so the walker follows the page the admin is on. */
export function projectIdFromPath(pathname: string): string | null {
  const match =
    /\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(
      pathname,
    );
  return match?.[1]?.toLowerCase() ?? null;
}
