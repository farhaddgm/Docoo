import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CreateKnowledgeForm } from './sources-panel';
import { knowledgeMessages } from './knowledge-messages';
import type { SourceRow } from './knowledge-types';

const source = {
  id: 's1',
  title: 'سیاست تخفیف',
  kind: 'text',
  version: 1,
  currentVersionId: 'v1',
  currentVersion: { status: 'partial' },
  scope: { type: 'workspace', id: 'w1', title: null },
  knowledge: [],
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as SourceRow;

describe('create knowledge form (first render)', () => {
  it('opens on the basics step with the stepper, help buttons and a disabled-free next', () => {
    for (const locale of ['fa', 'en'] as const) {
      const text = knowledgeMessages(locale);
      const html = renderToStaticMarkup(
        createElement(CreateKnowledgeForm, {
          locale,
          workspaceId: 'w1',
          source,
          options: null,
          onCancel: () => {},
          onDone: async () => {},
        }),
      );
      expect(html).toContain(text.createSteps.basics);
      expect(html).toContain(text.createSteps.review);
      expect(html).toContain(text.createNext);
      expect(html).not.toContain(text.createSubmit);
      expect((html.match(/info-tip-button/g) ?? []).length).toBeGreaterThanOrEqual(4);
      expect(html).toContain('aria-current="step"');
    }
  });
});
