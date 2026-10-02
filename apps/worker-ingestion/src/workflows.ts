import { proxyActivities } from '@temporalio/workflow';

import type { IngestionActivities } from './activities.js';
import type { IngestionInput, StepResult } from '@docoo/ingestion';

const scan = proxyActivities<IngestionActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 5 },
});

const extract = proxyActivities<IngestionActivities>({
  startToCloseTimeout: '60 minutes',
  retry: { initialInterval: '10 seconds', backoffCoefficient: 2, maximumAttempts: 3 },
});

/**
 * IngestionWorkflow (docs/04-architecture/04-workflows-and-jobs.md): quarantine checks and
 * malware scan, then sandboxed extraction with OCR/transcription. The workflow id is
 * `ingest-<sourceVersionId>`, so a version is ingested at most once at a time; both steps
 * are idempotent and safe to retry.
 */
export async function ingestSourceVersion(input: IngestionInput): Promise<StepResult> {
  const scanned = await scan.scanSource(input);
  if (scanned.status !== 'accepted') return scanned;
  return extract.extractSource(input);
}
