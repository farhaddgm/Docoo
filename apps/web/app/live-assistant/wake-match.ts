/**
 * Deciding whether what the browser heard is the wake phrase (ADR-0057 §15). Speech recognition
 * writes a name the way it sounds to it ("docoo", "doku", "do coo", "Dako"), so the phrase is not
 * compared letter by letter: both sides are reduced to a rough sound key, and the phrase is found
 * when the key of the last words differs by at most one letter AND has the same consonants. The
 * second rule is what keeps "hi do you" and "hi doctor" from waking it.
 */

const GREETINGS = ['hi', 'hey', 'hay', 'high', 'hai', 'hye'];

/** Lower case words, letters only. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '');
}

/** The sound key of a run of letters: c/k/q alike, long vowels short, doubled letters single. */
export function soundKey(text: string): string {
  const letters = words(text).join('');
  return letters
    .replace(/ck|c(?![eiy])|q/gu, 'k')
    .replace(/ou|oo|ow|u/gu, 'u')
    .replace(/([a-z])\1+/gu, '$1');
}

/** Consonants only, in order. */
function skeleton(key: string): string {
  return key.replace(/[aeiouy]/gu, '');
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = Math.min(
        above + 1,
        (row[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

/** The phrase with its greeting made one ("hey docoo" and "hi docoo" are the same call). */
function canonical(heard: readonly string[]): string[] {
  const [first, ...rest] = heard;
  return first !== undefined && GREETINGS.includes(first) ? ['hi', ...rest] : [...heard];
}

/**
 * Whether the end of `transcript` (the last words, as many as the phrase has, give or take one:
 * recognisers split and join names) is the wake phrase.
 */
export function matchesWakePhrase(transcript: string, phrase: string): boolean {
  const wanted = canonical(words(phrase));
  if (wanted.length === 0) return false;
  const wantedKey = soundKey(wanted.join(''));
  // A key too short to tell from chance is never matched loosely.
  const tolerance = wantedKey.length >= 6 ? 1 : 0;
  const heard = canonical(words(transcript));
  for (let span = Math.max(1, wanted.length - 1); span <= wanted.length + 1; span += 1) {
    if (heard.length < span) continue;
    const slice = heard.slice(heard.length - span);
    const key = soundKey(canonical(slice).join(''));
    if (skeleton(key) !== skeleton(wantedKey)) continue;
    if (distance(key, wantedKey) <= tolerance) return true;
  }
  return false;
}
