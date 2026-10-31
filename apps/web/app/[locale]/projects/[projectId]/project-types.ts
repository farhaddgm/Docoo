import type { ProblemPatternSnapshot } from '@docoo/contracts';

/** Project as the API returns it (docs/04-architecture/03-api-contracts.md §5). */
export interface ProjectDetail {
  problemPattern?: ProblemPatternSnapshot | null;
  id: string;
  code: string;
  title: string;
  description: string;
  initialProblem: string;
  /** What the administrator expects to receive (ADR-0043); empty when not said. */
  expectedOutput: string;
  outputLanguage: 'fa' | 'en';
  analysisProfile?: 'full' | 'quick';
  status: string;
  currentStage: string;
  pauseReason: string | null;
  nextAction: string;
  availableCommands: string[];
  topics: {
    topicId: string;
    code: string;
    title: string;
    priority: number;
    conflictInstruction: string | null;
    knowledgeSharing: 'none' | 'selected' | 'all';
    topicStatus: string;
  }[];
  /** Own knowledge items shared on topics set to `selected` (ADR-0034). */
  sharedKnowledgeIds: string[];
  /** The business of Contenter the project is linked to (ADR-0021); null when it has none. */
  business: { externalBusinessId: string; name: string } | null;
  approvedProblemVersionId: string | null;
  clonedFromId?: string | null;
  originKind?: 'copy' | 'continuation' | 'pivot' | null;
  version: number;
  deletedAt: string | null;
  purgeAfter: string | null;
  updatedAt: string;
}
