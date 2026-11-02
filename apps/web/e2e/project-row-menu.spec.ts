import { expect, test } from '@playwright/test';

import { projectMessages } from '../app/[locale]/projects/messages';
import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import {
  createViaApi,
  expectNoSeriousA11yViolations,
  revealRow,
  signInWithKeyboard,
} from './support';

const text = projectMessages('fa');
const page_ = projectPageMessages('fa');
const stamp = Date.now().toString(36);

test.describe('the three-dot menu at the end of each project row', () => {
  test('an administrator archives and deletes a project from the list', async ({ page }) => {
    await signInWithKeyboard(page);
    const make = (code: string) =>
      createViaApi(page, '/projects', {
        code,
        title: `پروژه منوی ردیف ${code}`,
        initialProblem: 'مسئله آزمون منوی سه‌نقطه',
        outputLanguage: 'fa',
      });
    await make(`rm-a-${stamp}`);
    await make(`rm-d-${stamp}`);

    await page.goto('/fa/projects');
    const rowOf = (code: string) =>
      page.getByRole('table').locator('tbody tr').filter({ hasText: code });
    await revealRow(page, page.getByRole('rowheader', { name: `rm-a-${stamp}` }));
    await revealRow(page, page.getByRole('rowheader', { name: `rm-d-${stamp}` }));

    // The button sits at the end of the row and names its project; the menu offers both commands.
    const menuButton = (code: string) =>
      rowOf(code).getByRole('button', { name: text.rowActionsFor.replace('{code}', code) });
    await menuButton(`rm-a-${stamp}`).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText([
      page_.commands['archive']!,
      page_.commands['delete']!,
    ]);
    await expectNoSeriousA11yViolations(page);

    // Escape closes it and returns focus to the button.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(menuButton(`rm-a-${stamp}`)).toBeFocused();

    // Archive asks for confirmation first, then the row shows the new status.
    await menuButton(`rm-a-${stamp}`).click();
    await menu.getByRole('menuitem', { name: page_.commands['archive']! }).click();
    const confirmation = page.getByRole('form', {
      name: new RegExp(`${page_.commands['archive']}`, 'u'),
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: page_.cancel }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(rowOf(`rm-a-${stamp}`)).toContainText(text.statuses['draft']!);

    await menuButton(`rm-a-${stamp}`).click();
    await menu.getByRole('menuitem', { name: page_.commands['archive']! }).click();
    await page.getByRole('button', { name: page_.confirm }).click();
    await expect(
      page.getByRole('status').filter({ hasText: page_.done['archive']! }),
    ).toBeVisible();
    await expect(rowOf(`rm-a-${stamp}`)).toContainText(text.statuses['archived']!);
    // An archived project can still be deleted but no longer archived.
    await menuButton(`rm-a-${stamp}`).click();
    await expect(menu.getByRole('menuitem')).toHaveText([page_.commands['delete']!]);
    await page.keyboard.press('Escape');

    // Delete leaves the default view (deleted projects are recoverable from their own view).
    await menuButton(`rm-d-${stamp}`).click();
    await menu.getByRole('menuitem', { name: page_.commands['delete']! }).click();
    await page.getByRole('button', { name: page_.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: page_.done['delete']! })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: `rm-d-${stamp}` })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });
});
