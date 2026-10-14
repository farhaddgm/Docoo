import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ProjectWizard } from '../app/[locale]/projects/new/project-wizard.tsx';

process.stdout.write(
  renderToString(
    createElement(ProjectWizard, {
      locale: 'en',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      onCreated: () => undefined,
    }),
  ),
);
