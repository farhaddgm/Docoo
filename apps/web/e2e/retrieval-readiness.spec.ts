import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('retrieval cannot accept input before React can handle its change events', async ({
  page,
}) => {
  const html = execFileSync(
    process.execPath,
    [
      resolve(__dirname, '../../api/node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve(__dirname, 'wizard-static.tsconfig.json'),
      resolve(__dirname, 'render-retrieval-static.mjs'),
    ],
    { encoding: 'utf8' },
  );
  await page.setContent(html);
  await expect(page.getByRole('textbox')).toBeDisabled();
  for (const select of await page.getByRole('combobox').all()) {
    await expect(select).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'Run the test' })).toBeDisabled();
});
