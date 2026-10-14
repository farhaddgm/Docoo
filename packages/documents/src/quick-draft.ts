import type { StructuredDocument } from './model.js';

export const QUICK_DRAFT_WARNING_ID = 'docoo-quick-draft-warning';
export const QUICK_DRAFT_WARNING = {
  fa: 'پیش‌نویس؛ ناقص‌تر از تحلیل کامل',
  en: 'Draft; less complete than full analysis',
} as const;

/** This marker survives editing, writing, restores and all native renderers. */
export function markQuickDraft(document: StructuredDocument): StructuredDocument {
  return {
    ...document,
    blocks: [
      {
        id: QUICK_DRAFT_WARNING_ID,
        type: 'callout',
        tone: 'warning',
        text: QUICK_DRAFT_WARNING[document.language],
      },
      ...document.blocks.filter((b) => b.id !== QUICK_DRAFT_WARNING_ID),
    ],
  };
}
