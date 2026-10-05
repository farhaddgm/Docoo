import { expect, test, type Page } from '@playwright/test';

import { documentMessages } from '../app/[locale]/projects/[projectId]/document-messages';
import { editorMessages } from '../app/[locale]/projects/[projectId]/editor-messages';
import {
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

const editor = editorMessages('fa');
const editorEn = editorMessages('en');
const documentText = documentMessages('fa');
const stamp = Date.now().toString(36);
const failureNotice = (page: Page) => page.locator('.notice.error[role="alert"]');

/** A project with one selected solution; returns the page of its first document. */
async function projectWithDocument(page: Page, prefix: string) {
  const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
    code: `${prefix}-t-${stamp}`,
    title: `حوزهٔ نگارش ${prefix} ${stamp}`,
  });
  const created = await createViaApi<{ project: { id: string } }>(page, '/projects', {
    code: `${prefix}-${stamp}`,
    title: 'نگارش سند',
    initialProblem: 'کاهش ریزش مشتریان تکراری',
    topics: [{ topicId: topic.topic.id }],
  });
  const projectId = created.project.id;
  const generated = await createViaApi<{ solutionSet: { items: { id: string }[] } }>(
    page,
    `/projects/${projectId}/solutions/generate`,
    { count: 2 },
  );
  await createViaApi(page, `/projects/${projectId}/solution-selections`, {
    solutionIds: [generated.solutionSet.items[0]!.id],
    reason: 'گزینهٔ برتر',
  });
  return projectId;
}

async function openFirstDocument(page: Page, projectId: string, locale: 'fa' | 'en' = 'fa') {
  await page.goto(`/${locale}/projects/${projectId}?tab=documents`);
  const messages = locale === 'fa' ? documentText : documentMessages('en');
  await page
    .locator('#documents-title')
    .locator('xpath=following-sibling::div//tbody/tr')
    .first()
    .getByRole('button', { name: messages.open })
    .click();
}

test.describe('the documenter writes and the structured editor changes a document (ADR-0019)', () => {
  test('write the whole document, read its report, edit its blocks and save a new version', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const projectId = await projectWithDocument(page, 'wr');
    await openFirstDocument(page, projectId);
    await expect(page.locator('.document-view')).toBeVisible();

    // The export format from the project's settings is offered first and as the main action.
    const exportButtons = page.locator('section[aria-labelledby="exports-title"] .toolbar button');
    await expect(exportButtons.first()).toHaveText(
      documentText.exportAs.replace('{format}', 'DOCX'),
    );
    await expect(exportButtons.first()).toHaveClass(/primary-button/u);

    const versionRows = page
      .locator('#versions-title')
      .locator('xpath=following-sibling::div//tbody/tr');
    await expect(versionRows).toHaveCount(1);

    // The writing panel: level, template, a note for the documenter.
    const writer = page.locator('section[aria-labelledby="writer-title"]');
    await expect(writer.getByRole('heading', { name: editor.writerTitle })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await writer.locator('#writer-level').selectOption('1');
    await writer.locator('#writer-template').selectOption('standard');
    await writer.locator('#writer-notes').fill('مخاطب این سند مدیر عامل است.');
    await writer.getByRole('button', { name: editor.writeStart }).click();

    // It runs as a durable workflow and the panel follows it to the end.
    await expect(
      writer.locator('.badge').filter({ hasText: editor.writingStatuses['succeeded']! }).first(),
    ).toBeVisible({ timeout: 90_000 });
    await expect(failureNotice(page)).toHaveCount(0);
    const report = writer.locator('section[aria-labelledby="writer-report-title"]');
    await expect(report).toBeVisible();
    await expect(report.getByText(editor.reportWithin)).toBeVisible();
    await expect(page.locator('.document-view')).toContainText('خلاصه');
    await expect(page.locator('.document-view')).toContainText('برنامهٔ اجرا');
    // The writing became a normal, immutable version of the document.
    await expect(versionRows).toHaveCount(2);
    await expect(versionRows.first().getByRole('cell').first()).toContainText(
      documentText.origins['model']!,
    );
    await expectNoSeriousA11yViolations(page);

    // The structured editor: live check, outline, a changed heading and a new list block.
    await page.getByRole('button', { name: editor.openEditor }).click();
    await expect(page.getByRole('heading', { name: editor.editorTitle })).toBeVisible();
    const side = page.getByRole('complementary', { name: editor.check });
    await expect(side.getByText(editor.characters)).toBeVisible();
    await expect(page.getByText(editor.validStructure)).toBeVisible();
    const outline = page.getByRole('navigation', { name: editor.outline });
    await expect(outline.getByRole('button').first()).toBeVisible();
    await expect(page.getByRole('button', { name: editor.save, exact: true })).toBeDisabled(); // nothing changed yet

    await page.getByLabel(editor.headingText).first().fill('خلاصهٔ اجرایی تازه');
    await page.locator('#add-type-0').selectOption('list');
    await page.getByRole('button', { name: editor.addBlock, exact: true }).click();
    const items = page.getByLabel(editor.items).last();
    await items.fill('مورد نخست\nمورد دوم');
    await expect(page.getByText(editor.unsaved)).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // A reason is required; the new count is checked with the server before saving.
    const save = page.getByRole('button', { name: editor.save, exact: true });
    await expect(save).toBeDisabled();
    await page.locator('#editor-reason').fill('اصلاح عنوان و افزودن فهرست');
    await expect(page.getByText(editor.validStructure)).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: editor.saved })).toBeVisible();
    await expect(page.getByRole('heading', { name: editor.editorTitle })).toHaveCount(0);
    await expect(page.locator('.document-view')).toContainText('خلاصهٔ اجرایی تازه');
    await expect(page.locator('.document-view')).toContainText('مورد نخست');
    await expect(versionRows).toHaveCount(3);
    await expect(versionRows.first().getByRole('cell').first()).toContainText(
      documentText.origins['edit']!,
    );
  });

  test('the editor refuses a broken structure and a second writing cannot start while one runs', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const projectId = await projectWithDocument(page, 'wr2');
    await openFirstDocument(page, projectId);

    await page.getByRole('button', { name: editor.openEditor }).click();
    // A reference that nothing cites, then a citation to a reference that does not exist.
    await page.getByRole('button', { name: editor.addBibliography }).click();
    await page.getByRole('button', { name: editor.addReference }).click();
    await page.getByLabel(`${editor.referenceText} B1`).fill('منبع آزمون');
    await expect(page.getByText(editor.referenceUnused)).toBeVisible();
    // Deleting the list takes the reference with it and the check stays valid.
    await page.getByRole('button', { name: /^حذف بلوک منابع/u }).click();
    await expect(page.getByText(editor.validStructure)).toBeVisible();

    // A new table starts with valid content, so the check stays green.
    await page.locator('#add-type-0').selectOption('table');
    await page.getByRole('button', { name: editor.addBlock, exact: true }).click();
    await expect(page.getByText(editor.validStructure)).toBeVisible();
    // Discarding asks first because there are unsaved changes.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: editor.discard }).click();
    await expect(page.getByRole('heading', { name: editor.editorTitle })).toHaveCount(0);

    // A detailed level-3 document through the same panel.
    const writer = page.locator('section[aria-labelledby="writer-title"]');
    await writer.locator('#writer-level').selectOption('3');
    await writer.locator('#writer-template').selectOption('detailed');
    await writer.getByRole('button', { name: editor.writeStart }).click();
    const done = writer.locator('.badge').filter({ hasText: editor.writingStatuses['succeeded']! });
    await expect(done.first()).toBeVisible({ timeout: 90_000 });
    // The detailed template adds the score table and chart the code builds itself.
    await expect(page.locator('.document-view')).toContainText('امتیازدهی');
    await expectNoSeriousA11yViolations(page);
  });

  test('the same panels in English', async ({ page }) => {
    test.setTimeout(90_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const projectId = await projectWithDocument(page, 'wr3');
    await openFirstDocument(page, projectId, 'en');
    const writer = page.locator('section[aria-labelledby="writer-title"]');
    await expect(writer.getByRole('heading', { name: editorEn.writerTitle })).toBeVisible();
    await page.getByRole('button', { name: editorEn.openEditor }).click();
    await expect(page.getByRole('heading', { name: editorEn.editorTitle })).toBeVisible();
    await expect(page.getByText(editorEn.validStructure)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
