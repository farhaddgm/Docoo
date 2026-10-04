/** The API answers a client that sends too many requests with this code (429, or 403 once banned). */
export const rateLimitErrors = {
  fa: {
    AUTH_RATE_LIMITED: 'درخواست‌ها بیش از حد مجاز بود؛ یک دقیقه صبر کنید و دوباره تلاش کنید.',
  },
  en: {
    AUTH_RATE_LIMITED: 'Too many requests were sent; wait a minute and try again.',
  },
} as const;
