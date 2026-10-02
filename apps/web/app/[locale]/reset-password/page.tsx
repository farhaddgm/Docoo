import { notFound } from 'next/navigation';

import { isLocale } from '../../i18n';
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ResetPasswordForm locale={locale} />;
}
