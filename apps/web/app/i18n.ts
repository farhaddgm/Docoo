export type Locale = 'fa' | 'en';

export const locales: readonly Locale[] = ['fa', 'en'];

export function isLocale(value: string): value is Locale {
  return value === 'fa' || value === 'en';
}

export function direction(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'fa' ? 'rtl' : 'ltr';
}

/** BCP 47 tags used for Intl formatting; stored values stay locale-neutral (FR-LOC-004). */
const intlTag: Record<Locale, string> = { fa: 'fa-IR', en: 'en-US' };

export function formatDate(locale: Locale, value: Date | string): string {
  return new Intl.DateTimeFormat(intlTag[locale], { dateStyle: 'long' }).format(new Date(value));
}

export function formatDateTime(locale: Locale, value: Date | string): string {
  return new Intl.DateTimeFormat(intlTag[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(intlTag[locale]).format(value);
}

/** Replaces the locale segment of a path so switching language keeps the page. */
export function localizedPath(pathname: string, locale: Locale): string {
  const segments = pathname.split('/');
  if (segments[1] && isLocale(segments[1])) segments[1] = locale;
  else segments.splice(1, 0, locale);
  return segments.join('/') || `/${locale}`;
}

export const navigation = [
  'dashboard',
  'projects',
  'topics',
  'knowledge',
  'agents',
  'templates',
  'brain',
  'providers',
  'costs',
  'audit',
  'settings',
] as const;

export type NavigationKey = (typeof navigation)[number];

const messages = {
  fa: {
    skipToContent: 'رفتن به محتوای اصلی',
    navigation: 'ناوبری اصلی',
    comingSoon: 'به‌زودی',
    switchLanguage: 'English',
    switchLanguageLabel: 'Switch to English',
    nav: {
      dashboard: 'داشبورد',
      projects: 'پروژه‌ها',
      topics: 'حوزه‌های موضوعی',
      knowledge: 'دانش و ممیزی',
      agents: 'ایجنت‌ها',
      templates: 'قالب‌ها و سطوح سند',
      brain: 'گزارش Brain',
      providers: 'ارائه‌دهندگان AI',
      costs: 'هزینه و مصرف',
      audit: 'Audit Log',
      settings: 'تنظیمات سامانه',
    } satisfies Record<NavigationKey, string>,
    dashboardTitle: 'داشبورد Docoo',
    dashboardSubtitle: 'محیط مدیریت پروژه‌ها و جریان کار',
    today: 'امروز',
    checkingSession: 'در حال بررسی نشست…',
    unavailable: 'ارتباط با سرویس برقرار نشد. وضعیت API را بررسی و دوباره تلاش کنید.',
    retry: 'تلاش دوباره',
    loginTitle: 'ورود ادمین',
    loginSubtitle: 'با ایمیل و گذرواژهٔ ادمین کل وارد شوید.',
    email: 'ایمیل',
    password: 'گذرواژه',
    signIn: 'ورود',
    signingIn: 'در حال ورود…',
    forgotPassword: 'گذرواژه را فراموش کرده‌اید؟',
    signedInAs: 'وارد شده با',
    workspaces: 'فضاهای کاری',
    signOut: 'خروج',
    signingOut: 'در حال خروج…',
    signedOut: 'از حساب خارج شدید.',
    statusTitle: 'وضعیت سامانه',
    statusValue: 'کنترل‌پنل آماده',
    nextTitle: 'مرحلهٔ بعد',
    nextValue: 'دریافت و حاکمیت دانش',
    resetRequestTitle: 'بازنشانی گذرواژه',
    resetRequestSubtitle: 'ایمیل حساب را وارد کنید تا پیوند یک‌بارمصرف ارسال شود.',
    sendResetLink: 'ارسال پیوند',
    sending: 'در حال ارسال…',
    resetRequestAccepted:
      'اگر این ایمیل متعلق به حساب فعالی باشد، پیوند بازنشانی برای آن ارسال می‌شود.',
    backToSignIn: 'بازگشت به ورود',
    resetTitle: 'تعیین گذرواژهٔ جدید',
    resetSubtitle: 'گذرواژهٔ جدید باید دست‌کم ۱۲ نویسه باشد. همهٔ نشست‌های قبلی بسته می‌شوند.',
    newPassword: 'گذرواژهٔ جدید',
    confirmPassword: 'تکرار گذرواژهٔ جدید',
    savePassword: 'ذخیرهٔ گذرواژه',
    saving: 'در حال ذخیره…',
    passwordsDiffer: 'دو گذرواژه یکسان نیستند.',
    resetDone: 'گذرواژه تغییر کرد. با گذرواژهٔ جدید وارد شوید.',
    resetLinkMissing: 'پیوند بازنشانی ناقص است. یک پیوند تازه درخواست کنید.',
    errors: {
      AUTH_INVALID_CREDENTIALS: 'ایمیل یا گذرواژه درست نیست.',
      AUTH_RATE_LIMITED: 'تلاش‌ها زیاد بوده است؛ کمی بعد دوباره امتحان کنید.',
      AUTH_PASSWORD_POLICY: 'گذرواژهٔ جدید باید دست‌کم ۱۲ نویسه و متفاوت از ایمیل باشد.',
      AUTH_RESET_TOKEN_INVALID: 'پیوند بازنشانی نامعتبر یا منقضی است. پیوند تازه درخواست کنید.',
      AUTH_CROSS_ORIGIN_REQUEST: 'درخواست از مبدأ مجاز ارسال نشده است.',
      generic: 'عملیات انجام نشد. دوباره تلاش کنید.',
    } as Record<string, string>,
  },
  en: {
    skipToContent: 'Skip to main content',
    navigation: 'Primary navigation',
    comingSoon: 'Coming soon',
    switchLanguage: 'فارسی',
    switchLanguageLabel: 'تغییر زبان به فارسی',
    nav: {
      dashboard: 'Dashboard',
      projects: 'Projects',
      topics: 'Topics',
      knowledge: 'Knowledge & audit',
      agents: 'Agents',
      templates: 'Templates & levels',
      brain: 'Brain report',
      providers: 'AI providers',
      costs: 'Cost & usage',
      audit: 'Audit log',
      settings: 'System settings',
    } satisfies Record<NavigationKey, string>,
    dashboardTitle: 'Docoo dashboard',
    dashboardSubtitle: 'Project and workflow administration',
    today: 'Today',
    checkingSession: 'Checking your session…',
    unavailable: 'The API could not be reached. Check its status and try again.',
    retry: 'Try again',
    loginTitle: 'Administrator sign in',
    loginSubtitle: 'Enter your Super Admin email and password.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    forgotPassword: 'Forgot your password?',
    signedInAs: 'Signed in as',
    workspaces: 'Workspaces',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    signedOut: 'You have signed out.',
    statusTitle: 'System status',
    statusValue: 'Control plane ready',
    nextTitle: 'Next slice',
    nextValue: 'Knowledge ingestion and governance',
    resetRequestTitle: 'Reset password',
    resetRequestSubtitle: 'Enter the account email to receive a single-use link.',
    sendResetLink: 'Send link',
    sending: 'Sending…',
    resetRequestAccepted: 'If this email belongs to an active account, a reset link is on its way.',
    backToSignIn: 'Back to sign in',
    resetTitle: 'Choose a new password',
    resetSubtitle: 'Use at least 12 characters. Every existing session will be signed out.',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    savePassword: 'Save password',
    saving: 'Saving…',
    passwordsDiffer: 'The two passwords do not match.',
    resetDone: 'Your password was changed. Sign in with the new password.',
    resetLinkMissing: 'The reset link is incomplete. Request a new one.',
    errors: {
      AUTH_INVALID_CREDENTIALS: 'The email or password is incorrect.',
      AUTH_RATE_LIMITED: 'Too many attempts. Please try again later.',
      AUTH_PASSWORD_POLICY: 'Use at least 12 characters that are not your email address.',
      AUTH_RESET_TOKEN_INVALID: 'The reset link is invalid or has expired. Request a new one.',
      AUTH_CROSS_ORIGIN_REQUEST: 'The request did not come from an allowed origin.',
      generic: 'Something went wrong. Please try again.',
    } as Record<string, string>,
  },
} as const;

export type Messages = (typeof messages)[Locale];

export function messagesFor(locale: Locale): Messages {
  return messages[locale];
}

/** Maps an API problem code to a localized, safe message. */
export function errorMessage(locale: Locale, code: string | undefined): string {
  const table = messages[locale].errors;
  return (code && table[code]) || table['generic'] || '';
}

export async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}
