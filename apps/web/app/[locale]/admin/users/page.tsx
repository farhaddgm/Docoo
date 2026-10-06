import { notFound } from 'next/navigation';
import { AccountsScreen } from '../../accounts-screen';
export default async function Accounts({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') notFound();
  return <AccountsScreen locale={locale} />;
}
