import {
  extractStep,
  scanStep,
  type IngestionInput,
  type PipelineDependencies,
  type StepResult,
} from '@docoo/ingestion';

export interface IngestionActivities {
  scanSource(input: IngestionInput): Promise<StepResult>;
  extractSource(input: IngestionInput): Promise<StepResult>;
}

export function createActivities(deps: PipelineDependencies): IngestionActivities {
  return {
    scanSource: (input) => scanStep(input, deps),
    extractSource: (input) => extractStep(input, deps),
  };
}
