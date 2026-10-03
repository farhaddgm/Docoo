import { strToU8, zipSync } from 'fflate';

import { citationNumbers } from './html.js';
import type { Block, StructuredDocument } from './model.js';

export const DOCX_TEMPLATE_VERSION = 'docx-template-v1';

function xml(text: string): string {
  return text.replace(
    /[&<>"]/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );
}

/** Fixed zip timestamp so the same document version renders to the same bytes. */
const FIXED_DATE = new Date('2020-01-01T00:00:00Z');

export interface RenderMeta {
  readonly documentId: string;
  readonly version: number;
  /** Creation time of the source version; used for metadata instead of the clock. */
  readonly createdAt: string;
}

/**
 * DOCX with a fixed style map (Heading1..3, Caption, ListParagraph), real headings,
 * repeated table header rows, bidi paragraphs for Persian, captions, alt text and
 * document id/version metadata (05-document-pipeline §6).
 */
export function renderDocx(document: StructuredDocument, meta: RenderMeta): Uint8Array {
  const rtl = document.language === 'fa';
  const numbers = citationNumbers(document);
  const paragraphProps = (style?: string): string =>
    `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${rtl ? '<w:bidi/>' : ''}</w:pPr>`;
  const run = (
    text: string,
    options: { bold?: boolean; italic?: boolean; superscript?: boolean } = {},
  ): string =>
    `<w:r><w:rPr>${options.bold ? '<w:b/>' : ''}${options.italic ? '<w:i/>' : ''}${options.superscript ? '<w:vertAlign w:val="superscript"/>' : ''}${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  const paragraph = (text: string, style?: string): string =>
    `<w:p>${paragraphProps(style)}${run(text)}</w:p>`;

  const blockXml = (block: Block): string => {
    switch (block.type) {
      case 'heading':
        return paragraph(block.text, `Heading${block.level}`);
      case 'paragraph':
        return `<w:p>${paragraphProps()}${block.runs
          .map(
            (item) =>
              run(item.text, {
                ...(item.bold ? { bold: true } : {}),
                ...(item.italic ? { italic: true } : {}),
              }) +
              (item.citations ?? [])
                .map((id) => run(`[${numbers.get(id) ?? '?'}]`, { superscript: true }))
                .join(''),
          )
          .join('')}</w:p>`;
      case 'list':
        return block.items
          .map((item, index) =>
            paragraph(`${block.ordered ? `${index + 1}.` : '•'} ${item}`, 'ListParagraph'),
          )
          .join('');
      case 'table': {
        const cell = (text: string, header: boolean) =>
          `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${paragraphProps()}${run(text, header ? { bold: true } : {})}</w:p></w:tc>`;
        const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.columns.map((column) => cell(column, true)).join('')}</w:tr>`;
        const rows = block.rows
          .map((row) => `<w:tr>${row.map((value) => cell(value, false)).join('')}</w:tr>`)
          .join('');
        return `${paragraph(block.caption, 'Caption')}<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblW w:w="5000" w:type="pct"/><w:tblCaption w:val="${xml(block.caption)}"/></w:tblPr>${header}${rows}</w:tbl>${block.notes ? paragraph(block.notes) : ''}`;
      }
      case 'figure':
        return `${paragraph(`[${block.alt}]`)}${paragraph(block.caption, 'Caption')}`;
      case 'chart':
        return `${paragraph(`[${block.alt}]`)}<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblCaption w:val="${xml(block.title)}"/></w:tblPr><w:tr><w:trPr><w:tblHeader/></w:trPr>${block.labels
          .map(
            (label) => `<w:tc><w:p>${paragraphProps()}${run(label, { bold: true })}</w:p></w:tc>`,
          )
          .join('')}</w:tr><w:tr>${block.values
          .map((value) => `<w:tc><w:p>${paragraphProps()}${run(String(value))}</w:p></w:tc>`)
          .join(
            '',
          )}</w:tr></w:tbl>${paragraph(`${block.title} (${block.unit}) — ${block.source}`, 'Caption')}`;
      case 'callout':
        return paragraph(block.text, 'Quote');
      case 'pageBreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case 'appendix':
        return paragraph(block.title, 'Heading1') + block.blocks.map(blockXml).join('');
      case 'bibliography':
        return block.entries
          .map((entry, index) =>
            paragraph(`[${index + 1}] ${entry.text}${entry.url ? ` ${entry.url}` : ''}`),
          )
          .join('');
    }
  };

  const body = `${paragraph(document.title, 'Title')}${document.blocks.map(blockXml).join('')}<w:sectPr>${rtl ? '<w:bidi/>' : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1020" w:bottom="1247" w:left="1020" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const styles = ['Title', 'Heading1', 'Heading2', 'Heading3', 'Caption', 'ListParagraph', 'Quote']
    .map(
      (id, index) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id === 'Heading1' || id === 'Heading2' || id === 'Heading3' ? `heading ${id.slice(-1)}` : id}"/><w:basedOn w:val="Normal"/>${index <= 3 ? `<w:pPr><w:keepNext/><w:outlineLvl w:val="${Math.max(0, index - 1)}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24][index]}"/></w:rPr>` : ''}</w:style>`,
    )
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'word/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/><w:sz w:val="22"/><w:lang w:val="${rtl ? 'fa-IR' : 'en-US'}" w:bidi="fa-IR"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>${styles}</w:styles>`,
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
    'docProps/core.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(document.title)}</dc:title><dc:identifier>${xml(meta.documentId)}</dc:identifier><cp:version>${meta.version}</cp:version><dc:language>${document.language}</dc:language><cp:keywords>${DOCX_TEMPLATE_VERSION}</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">${xml(meta.createdAt)}</dcterms:created></cp:coreProperties>`,
    ),
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, [data, { mtime: FIXED_DATE }]]),
    ),
    { level: 6 },
  );
}
