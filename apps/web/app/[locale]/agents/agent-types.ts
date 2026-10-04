/** Shapes of the agent API (docs/04-architecture/03-api-contracts.md §11). */
export const agentRoles = [
  'analyst',
  'researcher',
  'ideator',
  'documenter',
  'evaluator',
  'brain',
] as const;
export type AgentRole = (typeof agentRoles)[number];

export const isAgentRole = (value: string): value is AgentRole =>
  (agentRoles as readonly string[]).includes(value);

export const agentTools = [
  'web_search',
  'web_read',
  'knowledge_retrieve',
  'project_documents_read',
  'table_chart_spec',
  'calculator',
  'citation_verifier',
  'document_renderer',
  'request_human_input',
] as const;
export type AgentTool = (typeof agentTools)[number];

export type Section = 'principles' | 'duties' | 'prompt' | 'tools' | 'model';
export const sections: readonly Section[] = ['principles', 'duties', 'prompt', 'tools', 'model'];

export interface ModelPolicy {
  connectionId: string;
  model: string;
}

export interface Definition {
  id: string;
  role: AgentRole;
  projectId: string | null;
  sequence: number;
  principles: string[];
  duties: string[];
  promptTemplate: string;
  tools: AgentTool[];
  modelPolicy: ModelPolicy | null;
  outputSchemaId: string;
  changedSections: Section[];
  baseVersionId: string | null;
  reason: string;
  createdBy: string | null;
  createdAt: string;
  /** Workspace history: the active default. Project history: the version the project runs. */
  active?: boolean;
}

export interface Limits {
  maxItems: number;
  maxItemLength: number;
  minPromptLength: number;
  maxPromptLength: number;
  minReasonLength: number;
  maxReasonLength: number;
}

/** What the editor shows next to a definition and never lets the administrator change. */
export interface Reference {
  tools: AgentTool[];
  toolCeiling: AgentTool[];
  limits: Limits;
  outputSchema: Record<string, unknown> | null;
}

export type ModelWarning =
  'connection_unavailable' | 'catalog_missing' | 'model_not_in_catalog' | 'no_structured_output';

export interface RoleSummary {
  role: AgentRole;
  stage: string | null;
  active: {
    id: string;
    sequence: number;
    createdAt: string;
    reason: string;
    changedSections: Section[];
    counts: { principles: number; duties: number; tools: number };
    modelPolicy: ModelPolicy | null;
  };
  latestSequence: number;
  versionCount: number;
  toolCeiling: AgentTool[];
}

export interface Performance {
  reportId: string;
  createdAt: string;
  charterVersion: string;
  role: {
    deviations: number;
    invocations: number;
    costUsd: number;
    avgLatencyMs: number | null;
    retries: number;
  } | null;
  deviations: { rule: string; severity: string; count: number; detail: string }[];
}

export interface RoleDetail extends Reference {
  role: AgentRole;
  stage: string | null;
  definition: Definition;
  latestSequence: number;
  modelWarnings: ModelWarning[];
  performance: Performance | null;
}

export interface RoleOutput {
  id: string;
  stageRunId?: string;
  projectId: string | null;
  projectTitle: string | null;
  stage?: string;
  versionNo?: number;
  origin?: string;
  definitionVersionId?: string | null;
  definitionSequence?: number | null;
  scope?: string;
  charterVersion?: string;
  createdAt: string;
}

export interface ProjectProfile {
  role: AgentRole;
  stage: string | null;
  pinned: boolean;
  customized: boolean;
  version: {
    id: string;
    sequence: number;
    createdAt: string;
    reason: string;
    counts: { principles: number; duties: number; tools: number };
    modelPolicy: ModelPolicy | null;
  };
  defaultVersion: { id: string; sequence: number };
  behindDefault: boolean;
}

export interface ProjectRoleDetail extends Reference {
  role: AgentRole;
  stage: string | null;
  pinned: boolean;
  customized: boolean;
  definition: Definition;
  defaultDefinition: Definition;
  behindDefault: boolean;
  ownVersions: Definition[];
  latestSequence: number;
  modelWarnings: ModelWarning[];
}

/** What the administrator is editing before it is saved as a new version. */
export interface Draft {
  principles: string[];
  duties: string[];
  promptTemplate: string;
  tools: AgentTool[];
  modelPolicy: ModelPolicy | null;
}

export function draftOf(definition: Definition): Draft {
  return {
    principles: [...definition.principles],
    duties: [...definition.duties],
    promptTemplate: definition.promptTemplate,
    tools: [...definition.tools],
    modelPolicy: definition.modelPolicy ? { ...definition.modelPolicy } : null,
  };
}

const trimAll = (items: readonly string[]) => items.map((item) => item.trim());
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** The sections of the draft that differ from the version it starts from. */
export function changedSections(base: Draft, draft: Draft): Section[] {
  const changed: Section[] = [];
  if (!sameList(trimAll(base.principles), trimAll(draft.principles))) changed.push('principles');
  if (!sameList(trimAll(base.duties), trimAll(draft.duties))) changed.push('duties');
  if (base.promptTemplate.trim() !== draft.promptTemplate.trim()) changed.push('prompt');
  if (!sameList([...base.tools].sort(), [...draft.tools].sort())) changed.push('tools');
  if (JSON.stringify(base.modelPolicy) !== JSON.stringify(draft.modelPolicy)) changed.push('model');
  return changed;
}

/** The request body `changes` for the sections that differ; nothing else is sent. */
export function changesBody(base: Draft, draft: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const section of changedSections(base, draft)) {
    if (section === 'principles') body['principles'] = trimAll(draft.principles);
    if (section === 'duties') body['duties'] = trimAll(draft.duties);
    if (section === 'prompt') body['promptTemplate'] = draft.promptTemplate.trim();
    if (section === 'tools') body['tools'] = draft.tools;
    if (section === 'model') body['modelPolicy'] = draft.modelPolicy;
  }
  return body;
}
