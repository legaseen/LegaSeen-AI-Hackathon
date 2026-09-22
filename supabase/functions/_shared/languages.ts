/**
 * Languages the interviewer can work in. Codes are ISO 639-1 (what Scribe
 * accepts and returns as `language_code`, though it sometimes returns the
 * 639-3 form — see `normaliseLang`).
 *
 * `tts` says which ElevenLabs model can speak it: multilingual_v2 is the
 * steady default; v3 covers the rest (Vietnamese, Telugu, Punjabi, …) at
 * the cost of being less predictable.
 */
export type Lang = { code: string; name: string; native: string; tts: "eleven_multilingual_v2" | "eleven_v3" };

export const LANGUAGES: Lang[] = [
  { code: "en", name: "English",    native: "English",     tts: "eleven_multilingual_v2" },
  { code: "el", name: "Greek",      native: "Ελληνικά",    tts: "eleven_multilingual_v2" },
  { code: "it", name: "Italian",    native: "Italiano",    tts: "eleven_multilingual_v2" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt",  tts: "eleven_v3" },
  { code: "zh", name: "Mandarin",   native: "普通话",       tts: "eleven_multilingual_v2" },
  { code: "ar", name: "Arabic",     native: "العربية",     tts: "eleven_multilingual_v2" },
  { code: "hi", name: "Hindi",      native: "हिन्दी",       tts: "eleven_multilingual_v2" },
  { code: "ta", name: "Tamil",      native: "தமிழ்",       tts: "eleven_multilingual_v2" },
  { code: "te", name: "Telugu",     native: "తెలుగు",      tts: "eleven_v3" },
  { code: "pa", name: "Punjabi",    native: "ਪੰਜਾਬੀ",      tts: "eleven_v3" },
  { code: "ur", name: "Urdu",       native: "اردو",        tts: "eleven_v3" },
  { code: "es", name: "Spanish",    native: "Español",     tts: "eleven_multilingual_v2" },
  { code: "tl", name: "Filipino",   native: "Filipino",    tts: "eleven_multilingual_v2" },
  { code: "ko", name: "Korean",     native: "한국어",       tts: "eleven_multilingual_v2" },
  { code: "ja", name: "Japanese",   native: "日本語",       tts: "eleven_multilingual_v2" },
  { code: "de", name: "German",     native: "Deutsch",     tts: "eleven_multilingual_v2" },
  { code: "fr", name: "French",     native: "Français",    tts: "eleven_multilingual_v2" },
  { code: "pl", name: "Polish",     native: "Polski",      tts: "eleven_multilingual_v2" },
  { code: "hr", name: "Croatian",   native: "Hrvatski",    tts: "eleven_multilingual_v2" },
  { code: "sr", name: "Serbian",    native: "Српски",      tts: "eleven_v3" },
  { code: "mk", name: "Macedonian", native: "Македонски",  tts: "eleven_v3" },
  { code: "ru", name: "Russian",    native: "Русский",     tts: "eleven_multilingual_v2" },
  { code: "tr", name: "Turkish",    native: "Türkçe",      tts: "eleven_multilingual_v2" },
  { code: "fa", name: "Persian",    native: "فارسی",       tts: "eleven_v3" },
  { code: "pt", name: "Portuguese", native: "Português",   tts: "eleven_multilingual_v2" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", tts: "eleven_multilingual_v2" },
];

const THREE_TO_TWO: Record<string, string> = {
  eng: "en", ell: "el", gre: "el", ita: "it", vie: "vi", zho: "zh", chi: "zh", cmn: "zh", yue: "zh", ara: "ar",
  hin: "hi", tam: "ta", tel: "te", pan: "pa", urd: "ur", spa: "es", tgl: "tl", fil: "tl", kor: "ko", jpn: "ja",
  deu: "de", ger: "de", fra: "fr", fre: "fr", pol: "pl", hrv: "hr", srp: "sr", mkd: "mk", mac: "mk", rus: "ru",
  tur: "tr", fas: "fa", per: "fa", por: "pt", ind: "id",
};

/** "eng" → "en", "en-AU" → "en", unknown → as given (lowercased, base subtag). */
export function normaliseLang(code: string | null | undefined): string {
  if (!code) return "";
  const base = code.toLowerCase().split(/[-_]/)[0]!;
  return THREE_TO_TWO[base] ?? base;
}

export function langByCode(code: string): Lang | undefined {
  return LANGUAGES.find((l) => l.code === normaliseLang(code));
}
