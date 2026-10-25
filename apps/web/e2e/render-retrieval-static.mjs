import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { RetrievalPanel } from '../app/[locale]/knowledge/retrieval-panel.tsx';

process.stdout.write(
  renderToString(
    createElement(RetrievalPanel, {
      locale: 'en',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    }),
  ),
);
