import type { LiveNewProjectFill } from '@docoo/contracts';
import { useEffect, useRef } from 'react';

import { screenBus, type FormHandler, type FormName } from './screen';

/**
 * A form that can take a draft from the assistant (ADR-0055 §4-6). It says it is on the screen and
 * ready; `apply` is called with the values, which it puts in the form the same way typing would, so
 * nothing is saved and the owner presses the button. A form that is not ready is not registered.
 */
export function useAssistantForm(form: FormName, ready: boolean, apply: FormHandler): void {
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    if (!ready) return;
    return screenBus.registerForm(form, (values) => latest.current(values));
  }, [form, ready]);
}

/** The order the fields are filled in: the title first, so a code can be suggested from it. */
export const NEW_PROJECT_FIELDS = [
  'title',
  'code',
  'description',
  'initialProblem',
  'expectedOutput',
  'outputLanguage',
] as const satisfies readonly (keyof LiveNewProjectFill)[];

/** The element id of each field of the new-project form. */
export const NEW_PROJECT_IDS: Record<(typeof NEW_PROJECT_FIELDS)[number], string> = {
  title: 'project-title',
  code: 'project-code',
  description: 'project-description',
  initialProblem: 'project-problem',
  expectedOutput: 'project-expected-output',
  outputLanguage: 'project-language',
};

/** The fields a draft actually holds, in fill order. */
export function filledFields(values: LiveNewProjectFill): (typeof NEW_PROJECT_FIELDS)[number][] {
  return NEW_PROJECT_FIELDS.filter((field) => values[field] !== undefined);
}
