import { notFound, redirect } from 'next/navigation';

import { isLocale } from '../../i18n';

/** Templates and levels now sit at the top of the system settings. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  redirect(`/${locale}/settings`);
}
