'use client';

import type { Locale } from '../../../../i18n';
import { SignedIn } from '../../../signed-in';
import { ProblemPatternsScreen } from './problem-patterns-screen';

export function PatternsPage({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  return (
    <SignedIn
      locale={locale}
      title={locale === 'fa' ? 'الگوها' : 'Patterns'}
      subtitle={
        locale === 'fa'
          ? 'ساخت و مدیریت الگوهای اختیاری مسئله'
          : 'Create and manage optional problem patterns'
      }
    >
      {() => <ProblemPatternsScreen locale={locale} workspaceId={workspaceId} />}
    </SignedIn>
  );
}
