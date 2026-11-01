/**
 * Tiny store for "the AI is working" notices. It lives outside React so a task keeps showing while
 * the administrator moves between backoffice pages. Two sources feed it: requests that call a model
 * (see `aiTaskKeyFor`) and workflow runs that a page asked to watch.
 */
export interface AiTask {
  readonly id: string;
  /** Message key: `stage:<name>` for a workflow stage, `task:<name>` for a single request. */
  readonly key: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();
const requests = new Map<string, string>();
const workflows = new Map<string, string>();
const watched = new Set<string>();
let counter = 0;
let snapshot: readonly AiTask[] = [];

function publish(): void {
  snapshot = [
    ...[...workflows].map(([base, key]) => ({ id: `workflow:${base}`, key })),
    ...[...requests].map(([id, key]) => ({ id, key })),
  ];
  for (const listener of listeners) listener();
}

export function subscribeAiTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiTasks(): readonly AiTask[] {
  return snapshot;
}

const EMPTY: readonly AiTask[] = [];
export function getServerAiTasks(): readonly AiTask[] {
  return EMPTY;
}

/** Marks one model-backed request as running; call the returned function when it settles. */
export function beginAiTask(key: string): () => void {
  const id = `request:${(counter += 1)}`;
  requests.set(id, key);
  publish();
  return () => {
    if (requests.delete(id)) publish();
  };
}

/** Workflow runs to poll for a running stage, kept until the run stops running. */
export function watchWorkflow(base: string): void {
  watched.add(base);
}

export function watchedWorkflows(): readonly string[] {
  return [...watched];
}

/** Records the stage a watched run is working on, or forgets the run when nothing is running. */
export function setWorkflowStage(base: string, stage: string | null): void {
  if (stage === null) {
    watched.delete(base);
    if (workflows.delete(base)) publish();
    return;
  }
  const key = `stage:${stage}`;
  if (workflows.get(base) === key) return;
  workflows.set(base, key);
  publish();
}

/** Which requests call a model: their path decides the notice. Reads and plain saves are not listed. */
export function aiTaskKeyFor(method: string, path: string): string | null {
  if (method !== 'POST') return null;
  const clean = path.split('?')[0] ?? path;
  if (/\/analysis\/question-quality$/u.test(clean)) return 'task:questionQuality';
  if (/\/research-plan\/propose$/u.test(clean)) return 'task:researchPlan';
  if (/\/deliverables\/propose$/u.test(clean)) return 'task:deliverables';
  if (/\/projects\/[^/]+\/workflow\/(start|sync|redo)$/u.test(clean)) return 'task:workflow';
  if (/\/documents\/[^/]+\/evaluate$/u.test(clean)) return 'task:evaluate';
  if (/\/writings(\/[^/]+\/[^/]+)?$/u.test(clean)) return 'task:writing';
  if (/\/solutions\/sensitivity$/u.test(clean)) return 'task:sensitivity';
  if (/\/analysis-questions\/[^/]+\/suggest-answer$/u.test(clean)) return 'task:suggestAnswer';
  if (/\/stages\/[^/]+\/messages$/u.test(clean)) return 'task:chat';
  return null;
}
