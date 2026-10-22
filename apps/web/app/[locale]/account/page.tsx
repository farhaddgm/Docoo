import { notFound } from 'next/navigation';
import { AccountSettings } from '../account-settings';

export default async function Account({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') notFound();
  return <AccountSettings locale={locale} />;
}
