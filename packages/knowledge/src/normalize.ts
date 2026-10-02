const ARABIC_TO_PERSIAN: Record<string, string> = {
  ي: 'ی', // ي -> ی
  ى: 'ی', // ى -> ی
  ك: 'ک', // ك -> ک
  ة: 'ه', // ة -> ه
  ؤ: 'و', // ؤ -> و
  أ: 'ا', // أ -> ا
  إ: 'ا', // إ -> ا
};

const DIACRITICS = /[\u064B-\u065F\u0670]/gu;
const TATWEEL = /\u0640/gu;

/**
 * Canonical text for comparison and search: NFC, Persian letter forms, Persian and Arabic
 * digits as ASCII, no diacritics or tatweel, zero-width non-joiner as a space, collapsed
 * whitespace and lower case. Display text is never replaced by this form.
 */
export function normalizeForSearch(input: string): string {
  let text = input.normalize('NFKC');
  text = text.replace(/[يىكةؤأإ]/gu, (ch) => ARABIC_TO_PERSIAN[ch] ?? ch);
  text = text.replace(/[۰-۹]/gu, (ch) => String(ch.charCodeAt(0) - 0x06f0));
  text = text.replace(/[٠-٩]/gu, (ch) => String(ch.charCodeAt(0) - 0x0660));
  text = text.replace(DIACRITICS, '').replace(TATWEEL, '');
  text = text.replace(/\u200C|\u200D|\u200E|\u200F|\u00A0/gu, ' ');
  return text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
}

/** Light display cleanup for extracted text: Persian letter forms and whitespace only. */
export function normalizeExtractedText(input: string): string {
  return (
    input
      // eslint-disable-next-line no-control-regex -- strips control characters PostgreSQL text cannot hold
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
      .normalize('NFC')
      .replace(/[يىك]/gu, (ch) => ARABIC_TO_PERSIAN[ch] ?? ch)
      .replace(/[ \t\u00A0]+/gu, ' ')
      .replace(/ *\n */gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim()
  );
}

/** Word tokens of the search form (letters, marks and digits). */
export function tokenize(input: string): string[] {
  return normalizeForSearch(input).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}
