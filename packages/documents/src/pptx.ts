import { strToU8, zipSync } from 'fflate';

import type { RenderMeta } from './docx.js';
import { walkBlocks, type Block, type StructuredDocument } from './model.js';

export const PPTX_TEMPLATE_VERSION = 'pptx-summary-v1';
const FIXED_DATE = new Date('2020-01-01T00:00:00Z');
const MAX_BULLETS = 6;
const MAX_BULLET_CHARS = 220;

export class SlideOverflowError extends Error {
  constructor(
    readonly slide: number,
    readonly detail: string,
  ) {
    super(`slide ${slide}: ${detail}`);
  }
}

export interface Slide {
  readonly title: string;
  readonly bullets: readonly string[];
}

function xml(text: string): string {
  return text.replace(
    /[&<>"]/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?؟](\s|$)/su.exec(text.trim());
  return (match ? match[0] : text).trim();
}

function blockBullets(block: Block): string[] {
  switch (block.type) {
    case 'paragraph':
      return [firstSentence(block.runs.map((run) => run.text).join(''))];
    case 'list':
      return [...block.items];
    case 'table':
      return [block.caption];
    case 'chart':
      return [
        `${block.title}: ${block.labels.map((label, index) => `${label} ${block.values[index]}`).join(', ')} ${block.unit}`,
      ];
    case 'callout':
      return [firstSentence(block.text)];
    default:
      return [];
  }
}

/** Slide count by level: a management summary, not a copy of the document (§8). */
export function slideLimit(level: number): number {
  return level <= 1 ? 5 : level === 2 ? 7 : 10;
}

/** Title slide plus one slide per top-level section. Overflow is a validation failure. */
export function planSlides(document: StructuredDocument, level: number): Slide[] {
  const slides: Slide[] = [{ title: document.title, bullets: [] }];
  let current: { title: string; bullets: string[] } | null = null;
  for (const block of walkBlocks(document.blocks)) {
    if (block.type === 'heading' && block.level === 1) {
      if (current) slides.push(current);
      current = { title: block.text, bullets: [] };
    } else if (current && current.bullets.length < MAX_BULLETS) {
      current.bullets.push(...blockBullets(block).slice(0, MAX_BULLETS - current.bullets.length));
    }
  }
  if (current) slides.push(current);
  const limited = slides.slice(0, slideLimit(level));
  limited.forEach((slide, index) => {
    if (slide.title.length > 120)
      throw new SlideOverflowError(index + 1, 'title longer than 120 characters');
    for (const bullet of slide.bullets) {
      if (bullet.length > MAX_BULLET_CHARS)
        throw new SlideOverflowError(
          index + 1,
          `a bullet is longer than ${MAX_BULLET_CHARS} characters`,
        );
    }
  });
  return limited;
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function shape(
  id: number,
  name: string,
  placeholder: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  paragraphs: readonly string[],
  rtl: boolean,
  size: number,
): string {
  const body = paragraphs
    .map(
      (text) =>
        `<a:p><a:pPr algn="${rtl ? 'r' : 'l'}" rtl="${rtl ? 1 : 0}"/><a:r><a:rPr lang="${rtl ? 'fa-IR' : 'en-US'}" sz="${size}"/><a:t>${xml(text)}</a:t></a:r></a:p>`,
    )
    .join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body || '<a:p/>'}</p:txBody></p:sp>`;
}

/** Management-summary PPTX (DOC-103). */
export function renderPptx(
  document: StructuredDocument,
  level: number,
  meta: RenderMeta,
): { bytes: Uint8Array; slides: Slide[] } {
  const slides = planSlides(document, level);
  const rtl = document.language === 'fa';
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, content: string) => {
    files[name] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);
  };
  put(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${slides
      .map(
        (_, index) =>
          `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
      )
      .join('')}</Types>`,
  );
  put(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  put(
    'docProps/core.xml',
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(document.title)}</dc:title><dc:identifier>${xml(meta.documentId)}</dc:identifier><cp:version>${meta.version}</cp:version><cp:keywords>${PPTX_TEMPLATE_VERSION}</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">${xml(meta.createdAt)}</dcterms:created></cp:coreProperties>`,
  );
  put(
    'ppt/presentation.xml',
    `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rIdSlide${index + 1}"/>`)
      .join(
        '',
      )}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  put(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rIdSlide${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
  );
  put(
    'ppt/slideMasters/slideMaster1.xml',
    `<p:sldMaster ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  put(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  put(
    'ppt/slideLayouts/slideLayout1.xml',
    `<p:sldLayout ${NS} type="obj"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
  );
  put(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  const color = (name: string, value: string) =>
    `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
  put(
    'ppt/theme/theme1.xml',
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Docoo"><a:themeElements><a:clrScheme name="Docoo">${color('dk1', '111111')}${color('lt1', 'FFFFFF')}${color('dk2', '1F3A4A')}${color('lt2', 'EEF2F4')}${color('accent1', '2F6F8F')}${color('accent2', '5B8C5A')}${color('accent3', 'C17C2E')}${color('accent4', '8E4D7A')}${color('accent5', '3D7EA6')}${color('accent6', '9A9A9A')}${color('hlink', '2F6F8F')}${color('folHlink', '6B4E8F')}</a:clrScheme><a:fontScheme name="Docoo"><a:majorFont><a:latin typeface="DejaVu Sans"/><a:ea typeface=""/><a:cs typeface="DejaVu Sans"/></a:majorFont><a:minorFont><a:latin typeface="DejaVu Sans"/><a:ea typeface=""/><a:cs typeface="DejaVu Sans"/></a:minorFont></a:fontScheme><a:fmtScheme name="Docoo"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  );
  slides.forEach((slide, index) => {
    const title = shape(
      2,
      'Title',
      index === 0 ? 'ctrTitle' : 'title',
      457200,
      274638,
      11277600,
      1143000,
      [slide.title],
      rtl,
      index === 0 ? 4000 : 3200,
    );
    const body = slide.bullets.length
      ? shape(3, 'Content', 'body', 457200, 1600200, 11277600, 4525963, slide.bullets, rtl, 2000)
      : '';
    put(
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${title}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    put(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
  });
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, [data, { mtime: FIXED_DATE }]]),
    ),
    { level: 6 },
  );
  return { bytes, slides };
}
