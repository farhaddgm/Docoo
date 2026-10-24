import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('the static wizard cannot accept input before hydration and draft restoration', async ({
  page,
}) => {
  // Execute React SSR outside Playwright's JSX-to-component-protocol transform.
  // The API's already-installed TSX loader is shared by this monorepo's E2E harness.
  const html = execFileSync(
    process.execPath,
    [
      resolve(__dirname, '../../api/node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve(__dirname, 'wizard-static.tsconfig.json'),
      resolve(__dirname, 'render-wizard-static.mjs'),
    ],
    { encoding: 'utf8' },
  );
  // Render the actual server markup without any client JavaScript. A fast user must
  // not be able to enter values that hydration or draft restoration will overwrite.
  await page.setContent(html);
  for (const id of ['project-code', 'project-title', 'project-description', 'project-problem']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
});
