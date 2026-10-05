import type { Locale } from '../../i18n';

const messages = {
  fa: {
    title: 'دریافت خودکار قیمت‌ها',
    help: 'قیمت مدل‌های Docoo را از یک کاتالوگ عمومی (LiteLLM در GitHub) می‌خواند و کنار قیمت فعلی نشان می‌دهد. چیزی خودکار ثبت نمی‌شود؛ خودتان انتخاب می‌کنید. فقط قیمت پایه خوانده می‌شود، نه قیمت‌های ویژه (دسته‌ای، اولویت‌دار، متن بسیار طولانی). پیش از اتکا به هزینه، یک بار با صفحهٔ رسمی ارائه‌دهنده تطبیق دهید. هیچ اطلاعاتی از Docoo به آن سرویس فرستاده نمی‌شود.',
    fetch: 'دریافت قیمت‌ها از کاتالوگ عمومی',
    fetching: 'در حال دریافت…',
    refetch: 'دریافت دوباره',
    info: 'کاتالوگ {source} · {count} مدل متنی · دریافت‌شده در {time}',
    needsModelList:
      'فهرست مدل‌های بعضی اتصال‌ها هنوز گرفته نشده است؛ فعلاً فقط مدل پیش‌فرض و مدل‌هایی که قیمت دارند بررسی شدند. در بخش اتصال‌ها «به‌روزرسانی فهرست مدل‌ها» را بزنید و دوباره دریافت کنید.',
    caption: 'قیمت‌های پیشنهادی از کاتالوگ',
    selectAll: 'انتخاب همهٔ پیشنهادهای قابل‌ثبت',
    select: 'انتخاب',
    provider: 'ارائه‌دهنده',
    model: 'مدل',
    status: 'وضعیت',
    current: 'قیمت فعلی (ورودی / خروجی)',
    fromCatalog: 'قیمت کاتالوگ (ورودی / خروجی)',
    notes: 'توضیح',
    isDefault: 'مدل پیش‌فرض',
    statuses: {
      new: 'جدید',
      changed: 'تغییر کرده',
      same: 'یکسان',
      none: 'در کاتالوگ نیست',
      unusable: 'قیمت قابل‌اعتماد ندارد',
    },
    reasons: {
      zero_price: 'قیمت در کاتالوگ صفر است',
      no_price: 'قیمت در کاتالوگ نیست یا معتبر نیست',
    },
    sources: { manual: 'دستی', catalog: 'کاتالوگ' },
    alias: 'نام بدون تاریخ تطبیق داده شد؛ مطمئن شوید همین قیمت را دارد.',
    tiered: 'قیمت پایه؛ بالاتر از طول مشخصی از متن گران‌تر می‌شود.',
    retiring: 'بازنشسته می‌شود: {date}',
    cachedOf: 'کش‌شده {value}',
    reasoningOf: 'استدلال {value}',
    save: 'ثبت {count} قیمت انتخاب‌شده',
    saving: 'در حال ثبت…',
    nothingSelected: 'برای ثبت، دست‌کم یک قیمت را انتخاب کنید.',
    allSame: 'همهٔ قیمت‌های ثبت‌شده با کاتالوگ یکسان‌اند؛ کاری لازم نیست.',
    saved:
      'قیمت‌ها ثبت شد ({imported} ثبت‌شده، {skipped} بدون تغییر)؛ از فراخوانی بعدی اعمال می‌شود.',
    errors: {
      PRICE_CATALOG_UNAVAILABLE:
        'کاتالوگ قیمت در دسترس نیست. اتصال اینترنت سرور را بررسی کنید و بعداً دوباره تلاش کنید؛ تا آن زمان می‌توانید قیمت را دستی وارد کنید.',
      PRICE_CATALOG_CHANGED:
        'کاتالوگ بین نمایش و ثبت تغییر کرد. دوباره دریافت کنید و بازبینی کنید.',
      PRICE_CATALOG_NO_MATCH: 'برای یکی از مدل‌های انتخاب‌شده قیمت قابل‌اعتمادی در کاتالوگ نیست.',
    },
    failed: 'انجام نشد. دوباره تلاش کنید.',
  },
  en: {
    title: 'Get prices automatically',
    help: 'Reads the prices of the models Docoo uses from a public catalog (LiteLLM on GitHub) and shows them next to the current price. Nothing is saved on its own; you choose. Only the base price is read, not special prices (batch, priority, very long prompts). Check it once against the provider’s own pricing page before relying on the cost. Nothing from Docoo is sent to that service.',
    fetch: 'Get prices from the public catalog',
    fetching: 'Getting…',
    refetch: 'Get again',
    info: 'Catalog {source} · {count} text models · fetched {time}',
    needsModelList:
      'The model list of some connections has not been fetched yet; only the default model and the models that already have a price were checked. Use “Refresh models” on the connection and get the prices again.',
    caption: 'Prices suggested by the catalog',
    selectAll: 'Select every suggestion that can be saved',
    select: 'Select',
    provider: 'Provider',
    model: 'Model',
    status: 'Status',
    current: 'Current price (input / output)',
    fromCatalog: 'Catalog price (input / output)',
    notes: 'Notes',
    isDefault: 'Default model',
    statuses: {
      new: 'New',
      changed: 'Changed',
      same: 'Same',
      none: 'Not in the catalog',
      unusable: 'No reliable price',
    },
    reasons: {
      zero_price: 'The catalog price is zero',
      no_price: 'The catalog has no valid price',
    },
    sources: { manual: 'manual', catalog: 'catalog' },
    alias: 'Matched without the date in the name; make sure it has this price.',
    tiered: 'Base price; it costs more above a certain prompt length.',
    retiring: 'Retiring: {date}',
    cachedOf: 'cached {value}',
    reasoningOf: 'reasoning {value}',
    save: 'Save {count} selected prices',
    saving: 'Saving…',
    nothingSelected: 'Select at least one price to save.',
    allSame: 'Every saved price already matches the catalog; nothing to do.',
    saved: 'Prices saved ({imported} saved, {skipped} unchanged); they apply from the next call.',
    errors: {
      PRICE_CATALOG_UNAVAILABLE:
        'The price catalog is not reachable. Check the server’s internet connection and try again later; until then you can enter prices by hand.',
      PRICE_CATALOG_CHANGED:
        'The catalog changed between the preview and saving. Get the prices again and review them.',
      PRICE_CATALOG_NO_MATCH: 'The catalog has no reliable price for one of the chosen models.',
    },
    failed: 'That did not work. Try again.',
  },
};

export type CatalogText = (typeof messages)['fa'];
export const catalogMessages = (locale: Locale): CatalogText => messages[locale];
