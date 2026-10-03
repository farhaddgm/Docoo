import type { RenderMeta } from './docx.js';

export const PDF_TEMPLATE_VERSION = 'pdf-print-v1';

export class RendererUnavailableError extends Error {}

/**
 * PDF through headless Chromium (05-document-pipeline §7): JavaScript disabled, no network
 * (every request is aborted), deterministic header/footer with page numbers. The executable
 * comes from `PLAYWRIGHT_CHROMIUM_EXECUTABLE` or the Playwright browser cache.
 */
export async function renderPdf(html: string, meta: RenderMeta): Promise<Uint8Array> {
  const { chromium } = await import('playwright-core');
  const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] || undefined;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox'],
    });
  } catch (error) {
    throw new RendererUnavailableError(
      error instanceof Error ? error.message.split('\n')[0] : 'chromium unavailable',
    );
  }
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    await page.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort(),
    );
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7pt;width:100%;text-align:center;color:#666">${meta.documentId} · v${meta.version}</div>`,
      footerTemplate:
        '<div style="font-size:8pt;width:100%;text-align:center;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '22mm', bottom: '22mm', left: '18mm', right: '18mm' },
      tagged: true,
      outline: true,
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
