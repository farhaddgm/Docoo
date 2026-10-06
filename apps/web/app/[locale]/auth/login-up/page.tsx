import { notFound } from 'next/navigation';
import { AuthShell } from '../../auth-shell';
export const metadata = { robots: { index: false, follow: false } };
export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') notFound();
  return <AuthShell locale={locale} withPassword={true} loginPage />;
}
