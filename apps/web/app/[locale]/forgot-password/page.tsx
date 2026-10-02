import { notFound } from 'next/navigation';

import { isLocale } from '../../i18n';
import { ForgotPasswordForm } from './forgot-password-form';

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ForgotPasswordForm locale={locale} />;
}
