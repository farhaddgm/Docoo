import {
  liveScreenInstructionSchema,
  type LiveNewProjectFill,
  type LiveScreenInstruction,
  type LiveScreenPage,
} from '@docoo/contracts';

/**
 * What the assistant shows on the owner's screen (ADR-0055 §4-6). The server sends an instruction
 * naming a page or holding a draft for a form; this is the only code that turns it into a move in
 * the browser, so a model can never send the owner to an address of its own. Nothing here saves
 * anything: a form gets values to read, and the owner presses its button themselves.
 */

type OpenInstruction = Extract<LiveScreenInstruction, { type: 'open' }>;
type FillInstruction = Extract<LiveScreenInstruction, { type: 'fill' }>;

const PAGES: Record<Exclude<LiveScreenPage, 'project'>, string> = {
  projects: 'projects',
  new_project: 'projects/new',
  knowledge: 'knowledge',
  notifications: 'notifications',
  costs: 'costs',
  providers: 'providers',
  topics: 'topics',
  explorations: 'explorations',
  agents: 'agents',
  brain: 'brain',
  businesses: 'businesses',
  templates: 'templates',
};

/** The route of a page the assistant opens, in the owner's language. */
export function screenPath(locale: string, instruction: OpenInstruction): string {
  if (instruction.page === 'project') {
    const base = `/${locale}/projects/${instruction.projectId ?? ''}`;
    return instruction.tab ? `${base}?tab=${instruction.tab}` : base;
  }
  return `/${locale}/${PAGES[instruction.page]}`;
}

export const formPath = (locale: string): string => `/${locale}/${PAGES.new_project}`;

/**
 * A draft in a form must stay in front of the owner, so a page opened after it in the same
 * request is dropped: the last draft and what came before it is what gets shown.
 */
export function planScreen(list: readonly LiveScreenInstruction[]): LiveScreenInstruction[] {
  let lastFill = -1;
  list.forEach((item, index) => {
    if (item.type === 'fill') lastFill = index;
  });
  return list.filter((_, index) => lastFill < 0 || index <= lastFill);
}

/** The instruction a finished call carries in its result, if it carries a valid one. */
export function screenOfResult(result: unknown): LiveScreenInstruction | null {
  if (typeof result !== 'object' || result === null) return null;
  const parsed = liveScreenInstructionSchema.safeParse((result as { screen?: unknown }).screen);
  return parsed.success ? parsed.data : null;
}

export type FormName = FillInstruction['form'];
export type FormHandler = (values: LiveNewProjectFill) => void;

export interface ScreenBusDeps {
  /** Go to a route of this application. */
  readonly push: (href: string) => void;
  readonly pathname: () => string;
  readonly locale: () => string;
  /** Mark elements the assistant touched, so the owner sees where to look. */
  readonly highlight: (target: { ids: readonly string[] } | { main: true }) => void;
}

export function createScreenBus(deps: ScreenBusDeps) {
  const handlers = new Map<FormName, FormHandler>();
  const pending = new Map<FormName, LiveNewProjectFill>();

  function fill(instruction: FillInstruction): void {
    const handler = handlers.get(instruction.form);
    if (handler) {
      handler(instruction.values);
      return;
    }
    // The form is not on the screen yet: keep the values for when it appears, and go there.
    pending.set(instruction.form, { ...pending.get(instruction.form), ...instruction.values });
    const target = formPath(deps.locale());
    if (deps.pathname() !== target) deps.push(target);
  }

  return {
    apply(list: readonly LiveScreenInstruction[]): void {
      for (const instruction of planScreen(list)) {
        if (instruction.type === 'fill') {
          fill(instruction);
        } else {
          deps.push(screenPath(deps.locale(), instruction));
          deps.highlight({ main: true });
        }
      }
    },
    /** A form tells it is on the screen and ready; values waiting for it are handed over at once. */
    registerForm(form: FormName, handler: FormHandler): () => void {
      handlers.set(form, handler);
      const waiting = pending.get(form);
      if (waiting) {
        pending.delete(form);
        handler(waiting);
      }
      return () => {
        if (handlers.get(form) === handler) handlers.delete(form);
      };
    },
    /** Values still waiting for a form that has not appeared. */
    waiting(form: FormName): LiveNewProjectFill | undefined {
      return pending.get(form);
    },
  };
}

export type ScreenBus = ReturnType<typeof createScreenBus>;

// ---- in the browser ----------------------------------------------------------------------

const FLASH_CLASS = 'live-flash';
const FLASH_MS = 3500;

function flash(element: Element): void {
  element.classList.add(FLASH_CLASS);
  window.setTimeout(() => element.classList.remove(FLASH_CLASS), FLASH_MS);
}

/** Looks for the elements for a moment, because a page that was just opened draws a little later. */
function whenPresent(find: () => Element[], then: (found: Element[]) => void): void {
  const started = Date.now();
  const look = () => {
    const found = find();
    if (found.length > 0) {
      then(found);
      return;
    }
    if (Date.now() - started < 3000) window.setTimeout(look, 100);
  };
  look();
}

function browserHighlight(target: { ids: readonly string[] } | { main: true }): void {
  if (typeof document === 'undefined') return;
  const find =
    'main' in target
      ? () => Array.from(document.querySelectorAll('main h1'))
      : () =>
          target.ids
            .map((id) => document.getElementById(id))
            .filter((element): element is HTMLElement => element !== null);
  whenPresent(find, (found) => {
    for (const element of found) flash(element);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    found[0]?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  });
}

let push: (href: string) => void = () => undefined;

/** The one bus of this page. The host gives it the router. */
export const screenBus: ScreenBus = createScreenBus({
  push: (href) => push(href),
  pathname: () => (typeof location === 'undefined' ? '' : location.pathname),
  locale: () => {
    const first = typeof location === 'undefined' ? '' : location.pathname.split('/')[1];
    return first === 'en' ? 'en' : 'fa';
  },
  highlight: browserHighlight,
});

export function setScreenPush(next: (href: string) => void): void {
  push = next;
}

/** Marks form fields the assistant filled. */
export function highlightFields(ids: readonly string[]): void {
  browserHighlight({ ids });
}
