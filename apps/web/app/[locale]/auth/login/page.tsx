import { notFound } from 'next/navigation';
import { AuthShell } from '../../auth-shell';
export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') notFound();
  return <AuthShell locale={locale} withPassword={false} loginPage />;
}
