/** Project as the API returns it (docs/04-architecture/03-api-contracts.md §5). */
export interface ProjectDetail {
  id: string;
  code: string;
  title: string;
  description: string;
  initialProblem: string;
  outputLanguage: 'fa' | 'en';
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
    topicStatus: string;
  }[];
  /** The business of Contenter the project is linked to (ADR-0021); null when it has none. */
  business: { externalBusinessId: string; name: string } | null;
  approvedProblemVersionId: string | null;
  version: number;
  deletedAt: string | null;
  purgeAfter: string | null;
  updatedAt: string;
}
