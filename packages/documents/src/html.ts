import { walkBlocks, type Block, type StructuredDocument } from './model.js';

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

export function citationNumbers(document: StructuredDocument): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const block of walkBlocks(document.blocks)) {
    if (block.type === 'bibliography')
      block.entries.forEach((entry, index) => numbers.set(entry.id, index + 1));
  }
  return numbers;
}

/** Deterministic SVG for a chart spec; the renderer draws data, the model never draws pixels. */
export function chartSvg(block: Extract<Block, { type: 'chart' }>): string {
  const width = 560;
  const height = 240;
  const max = Math.max(...block.values, 0) || 1;
  const step = (width - 60) / block.values.length;
  const bars = block.values
    .map((value, index) => {
      const barHeight = Math.round(((height - 50) * value) / max);
      const x = 40 + index * step;
      const label = escapeHtml(block.labels[index] ?? '');
      return block.kind === 'bar'
        ? `<rect x="${x + 4}" y="${height - 30 - barHeight}" width="${Math.max(4, step - 8)}" height="${barHeight}" fill="#2f6f8f"/><text x="${x + step / 2}" y="${height - 12}" font-size="11" text-anchor="middle">${label}</text>`
        : `<circle cx="${x + step / 2}" cy="${height - 30 - barHeight}" r="3" fill="#2f6f8f"/><text x="${x + step / 2}" y="${height - 12}" font-size="11" text-anchor="middle">${label}</text>`;
    })
    .join('');
  const line =
    block.kind === 'line'
      ? `<polyline fill="none" stroke="#2f6f8f" stroke-width="2" points="${block.values
          .map(
            (value, index) =>
              `${40 + index * step + step / 2},${height - 30 - Math.round(((height - 50) * value) / max)}`,
          )
          .join(' ')}"/>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(block.alt)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><line x1="40" y1="${height - 30}" x2="${width - 20}" y2="${height - 30}" stroke="#555"/>${bars}${line}</svg>`;
}

function blockHtml(block: Block, numbers: Map<string, number>): string {
  switch (block.type) {
    case 'heading':
      return `<h${block.level + 1} id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h${block.level + 1}>`;
    case 'paragraph':
      return `<p>${block.runs
        .map((run) => {
          let text = escapeHtml(run.text);
          if (run.bold) text = `<strong>${text}</strong>`;
          if (run.italic) text = `<em>${text}</em>`;
          const refs = (run.citations ?? [])
            .map((id) => `<sup class="cite">[${numbers.get(id) ?? '?'}]</sup>`)
            .join('');
          return text + refs;
        })
        .join('')}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'table':
      return `<table><caption>${escapeHtml(block.caption)}</caption><thead><tr>${block.columns
        .map((column) => `<th scope="col">${escapeHtml(column)}</th>`)
        .join('')}</tr></thead><tbody>${block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join(
          '',
        )}</tbody></table>${block.notes ? `<p class="note">${escapeHtml(block.notes)}</p>` : ''}`;
    case 'figure':
      return `<figure><div class="asset" role="img" aria-label="${escapeHtml(block.alt)}">${escapeHtml(block.alt)}</div><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
    case 'chart':
      return `<figure class="chart">${chartSvg(block)}<figcaption>${escapeHtml(block.title)} (${escapeHtml(block.unit)}) — ${escapeHtml(block.source)}</figcaption></figure>`;
    case 'callout':
      return `<aside class="callout ${block.tone}">${escapeHtml(block.text)}</aside>`;
    case 'pageBreak':
      return '<div class="page-break"></div>';
    case 'appendix':
      return `<section class="appendix"><h2>${escapeHtml(block.title)}</h2>${block.blocks.map((child) => blockHtml(child, numbers)).join('')}</section>`;
    case 'bibliography':
      return `<ol class="bibliography">${block.entries
        .map(
          (entry) =>
            `<li id="ref-${escapeHtml(entry.id)}">${escapeHtml(entry.text)}${entry.url ? ` <a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a>` : ''}</li>`,
        )
        .join('')}</ol>`;
  }
}

/** Print-safe HTML with the document direction; input for the PDF renderer. */
export function renderHtml(
  document: StructuredDocument,
  meta: { documentId: string; version: number },
): string {
  const numbers = citationNumbers(document);
  const dir = document.language === 'fa' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${document.language}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title>
<meta name="docoo-document" content="${escapeHtml(meta.documentId)}"><meta name="docoo-version" content="${meta.version}">
<style>
@page { size: A4; margin: 22mm 18mm; }
body { font-family: "Vazirmatn", "DejaVu Sans", "Noto Sans Arabic", sans-serif; font-size: 11pt; line-height: 1.6; color: #111; }
h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; } h4 { font-size: 12pt; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 4px 6px; text-align: start; }
thead { display: table-header-group; } caption { caption-side: top; font-weight: bold; text-align: start; }
.page-break { break-after: page; } .callout { border-inline-start: 4px solid #2f6f8f; padding: 4px 10px; }
.cite { font-size: 8pt; } figure { margin: 8px 0; } .asset { border: 1px dashed #999; padding: 16px; }
</style></head><body><h1>${escapeHtml(document.title)}</h1>${document.blocks.map((block) => blockHtml(block, numbers)).join('')}</body></html>`;
}
