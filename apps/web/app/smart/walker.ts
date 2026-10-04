import type { Locale } from '../i18n';
import type { WalkerProgress, WalkerStep } from './api';

/**
 * Pages that exist for a walker step. Steps without a page yet are shown as guidance only;
 * set the route here when the page ships (docs/01-product/05-backoffice-ux.md).
 */
const STEP_ROUTES: Readonly<Record<string, string | undefined>> = {
  connect_provider: '/providers',
  review_brain: '/brain',
};

/** Localized path of the page that serves a step, or null while that page does not exist. */
export function stepHref(locale: Locale, key: string): string | null {
  const route = STEP_ROUTES[key];
  return route ? `/${locale}${route}` : null;
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
