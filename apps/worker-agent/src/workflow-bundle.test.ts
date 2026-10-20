import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode } from '@temporalio/worker';
import { expect, it } from 'vitest';

/** tsc cannot catch Node-only dependencies leaking through the public domain barrel. */
it('bundles the real workflow entry without Node evaluation or activity modules', async () => {
  const bundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(import.meta.resolve('@docoo/orchestration/workflows')),
  });
  expect(bundle.code.length).toBeGreaterThan(1000);
  expect(bundle.code).not.toContain('node:crypto');
  expect(bundle.code).not.toContain('docoo-stage-evaluation-model-v1');
}, 20_000);
