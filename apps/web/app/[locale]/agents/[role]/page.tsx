import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { isAgentRole } from '../agent-types';
import { RolePage } from '../role-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; role: string }>;
}) {
  const { locale, role } = await params;
  if (!isLocale(locale) || !isAgentRole(role)) notFound();

  return <RolePage locale={locale} role={role} />;
}
