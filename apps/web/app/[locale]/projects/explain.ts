import { ApiError } from '../../api-client';
import { explainError } from '../use-action';
import type { projectMessages } from './messages';

/** Localized message for a project API error; "not ready" lists what is still missing. */
export function explainProject(
  error: unknown,
  text: ReturnType<typeof projectMessages>,
  extra: Readonly<Record<string, string>> = {},
): string {
  const base = explainError(error, { ...text.errors, ...extra }, text.failed);
  if (error instanceof ApiError && error.code === 'PROJECT_NOT_READY') {
    const details = error.problems
      .map((problem) => text.notReady[problem])
      .filter((item): item is string => Boolean(item))
      .join(' ');
    return details ? `${base} ${details}` : base;
  }
  return base;
}
