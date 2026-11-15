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

/**
 * Words that carry no topic: particles, prepositions, question words and the affixes the
 * zero-width non-joiner splits off a word ("مشتری‌های" becomes "مشتری" and "های", "می‌شود" becomes
 * "می" and "شود"). Matching one of them joins a question to every document that has a plural or a
 * verb, which is noise. They are left out of the words a question looks for; documents keep every
 * word, so nothing becomes unfindable. Numbers and any word that can also name a thing are not here ("پس" is "then" and also "back" in "پس دادن", "روی" is "on" and "face").
 */
const STOPWORD_LIST = [
  // Persian: particles, prepositions, conjunctions, auxiliaries, question words
  'و',
  'در',
  'به',
  'از',
  'که',
  'را',
  'با',
  'این',
  'آن',
  'برای',
  'است',
  'بود',
  'شد',
  'شود',
  'می',
  'نمی',
  'هر',
  'یا',
  'تا',
  'هم',
  'نیز',
  'بر',
  'اما',
  'ولی',
  'اگر',
  'چه',
  'چرا',
  'چطور',
  'چگونه',
  'چند',
  'کدام',
  'آیا',
  'کی',
  'کجا',
  'باید',
  'شده',
  'کرد',
  'کرده',
  'کند',
  'کنند',
  'دارد',
  'دارند',
  'داد',
  'بین',
  'حتی',
  'فقط',
  'چون',
  'هنوز',
  'مگر',
  'خود',
  'همه',
  'هیچ',
  'بودن',
  'شدن',
  'کردن',
  'باشد',
  'باشند',
  'بوده',
  'هستند',
  'هست',
  'نیست',
  'نیستند',
  'ام',
  'ات',
  'اش',
  'ایم',
  'اید',
  'اند',
  // Persian: the pieces a zero-width non-joiner leaves (plural, comparative, ezafe-like)
  'های',
  'ها',
  'تر',
  'ترین',
  'ی',
  // English
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'how',
  'what',
  'why',
  'when',
  'where',
  'which',
  'who',
  'do',
  'does',
  'did',
  'can',
  'could',
  'should',
  'would',
  'with',
  'by',
  'at',
  'from',
  'as',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'we',
  'our',
  'you',
  'your',
  'my',
  'not',
  'no',
  'if',
  'than',
  'about',
];

const STOPWORDS: ReadonlySet<string> = new Set(
  STOPWORD_LIST.map((word) => normalizeForSearch(word)),
);

export const isStopword = (word: string): boolean => STOPWORDS.has(word);

/**
 * The words a question looks for: its tokens without repeats, of two letters or more, without
 * stopwords, at most `max`. When every word is a stopword the question keeps its own words, so a
 * question made only of such words still looks for something.
 */
export function queryTerms(question: string, max = 32): string[] {
  const words = [...new Set(tokenize(question))].filter((word) => word.length > 1);
  const topical = words.filter((word) => !isStopword(word));
  return (topical.length > 0 ? topical : words).slice(0, max);
}
