/** A voice as the list shows it: its name and, when the provider says, the languages it speaks. */
export function voiceLabel(voice: { name: string; languages: string[] }): string {
  const languages = voice.languages.slice(0, 4).join(', ');
  return languages === '' ? voice.name : `${voice.name} — ${languages}`;
}

/** Whether a voice speaks the conversation language ("auto" prefers none). */
export function voiceSpeaks(voice: { languages: string[] } | undefined, language: string): boolean {
  if (!voice || language === '' || language === 'auto') return false;
  return voice.languages.some((item) => item.toLowerCase().startsWith(language.toLowerCase()));
}
