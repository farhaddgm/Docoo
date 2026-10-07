import type { RenderMeta } from './docx.js';

export const PDF_TEMPLATE_VERSION = 'pdf-print-v1';

export class RendererUnavailableError extends Error {}

/**
 * PDF through headless Chromium (05-document-pipeline §7): JavaScript disabled, no network
 * (every request is aborted), deterministic header/footer with page numbers. The executable
 * comes from `PLAYWRIGHT_CHROMIUM_EXECUTABLE` or the Playwright browser cache.
 */
export async function renderPdf(html: string, meta: RenderMeta): Promise<Uint8Array> {
  const endpoint = process.env['PDF_RENDERER_URL'];
  if (!endpoint) {
    if (process.env['NODE_ENV'] === 'production')
      throw new RendererUnavailableError('Isolated PDF renderer is not configured.');
    return renderPdfLocally(html, meta);
  }
  const token = process.env['PDF_RENDERER_TOKEN'];
  if (!token || token.length < 32)
    throw new RendererUnavailableError('PDF renderer authentication is not configured.');
  try {
    const response = await fetch(new URL('/render', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ html, meta }),
      signal: AbortSignal.timeout(35_000),
      redirect: 'error',
    });
    if (
      !response.ok ||
      response.headers.get('content-type') !== 'application/pdf' ||
      !response.body
    )
      throw new Error('Invalid renderer response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk: unknown = part.value;
        if (!(chunk instanceof Uint8Array)) throw new Error('Invalid PDF chunk');
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('PDF too large');
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const pdf = Buffer.concat(chunks);
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF');
    return pdf;
  } catch {
    throw new RendererUnavailableError('Isolated PDF rendering failed.');
  }
}

/** Only the isolated renderer (or a development test) calls Chromium directly. */
export async function renderPdfLocally(html: string, meta: RenderMeta): Promise<Uint8Array> {
  const { chromium } = await import('playwright-core');
  const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] || undefined;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 10_000,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox'],
    });
  } catch (error) {
    throw new RendererUnavailableError(
      error instanceof Error ? error.message.split('\n')[0] : 'chromium unavailable',
    );
  }
  const deadline = setTimeout(() => {
    void browser.close().catch(() => undefined);
  }, 25_000);
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
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
    clearTimeout(deadline);
    await browser.close();
  }
}
