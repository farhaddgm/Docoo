import { notFound, redirect } from 'next/navigation';

import { isLocale } from '../../i18n';

/** The connections now live in the system settings, at the end of the page. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  redirect(`/${locale}/settings`);
}
