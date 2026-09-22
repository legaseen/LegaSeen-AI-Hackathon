/**
 * Runtime guardrails on what the interviewer is about to say.
 *
 * The model is asked for one short, open question in the session's language.
 * Models mostly comply; "mostly" is not a standard for something said aloud to
 * an elder, so every draft is checked here before it is spoken. A failed draft
 * gets one retry with the reasons; a second failure falls back to a fixed
 * prompt from the guide. Deterministic, cheap, and it records what it did.
 */

const SCRIPT: Record<string, RegExp> = {
  el: /\p{Script=Greek}/u,
  hi: /\p{Script=Devanagari}/u,
  zh: /\p{Script=Han}/u,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ko: /\p{Script=Hangul}/u,
  ar: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u, fa: /\p{Script=Arabic}/u,
  ru: /\p{Script=Cyrillic}/u, sr: /\p{Script=Cyrillic}/u, mk: /\p{Script=Cyrillic}/u,
  ta: /\p{Script=Tamil}/u,
  te: /\p{Script=Telugu}/u,
  pa: /\p{Script=Gurmukhi}/u,
};
const NO_SPACES = new Set(["zh", "ja"]);
const YES_NO_EN = /^(do|did|does|is|are|was|were|have|has|had|can|could|would|will|should)\b/i;

export const MAX_WORDS = 30;
export const MAX_CHARS_CJK = 60;

export type Verdict = { ok: boolean; reasons: string[] };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Word-set overlap; catches "the same question with two words moved". */
function similarity(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function vetQuestion(draft: { question: string; bridge?: string }, language: string, previous: string[]): Verdict {
  const reasons: string[] = [];
  const q = draft.question.trim();
  const bridge = (draft.bridge ?? "").trim();

  if (!q) reasons.push("empty question");

  // one question, not two
  const marks = (q.match(/[?？;]/g) ?? []).length;   // ";" is the Greek question mark
  if (marks > 1) reasons.push("more than one question");
  if (bridge && /[?？]/.test(bridge) && language !== "el") reasons.push("the bridge asks a question");

  // short enough to be said aloud
  if (NO_SPACES.has(language)) {
    if (q.length > MAX_CHARS_CJK) reasons.push(`too long (${q.length} chars > ${MAX_CHARS_CJK})`);
  } else {
    const words = norm(q).split(" ").filter(Boolean).length;
    if (words > MAX_WORDS) reasons.push(`too long (${words} words > ${MAX_WORDS})`);
  }

  // open, not yes/no (we can only judge this reliably in English)
  if (language === "en" && YES_NO_EN.test(q)) reasons.push("yes/no question");

  // the right language
  const script = SCRIPT[language];
  if (script && q && !script.test(q)) reasons.push(`not written in ${language}`);
  if (!script && language !== "en" && /\p{Script=Latin}/u.test(q) === false && q) {
    // Latin-script language with no Latin letters at all — wrong language
    reasons.push(`not written in ${language}`);
  }

  // not a repeat
  for (const p of previous) {
    if (similarity(p, q) >= 0.8) { reasons.push("repeats an earlier question"); break; }
  }

  // nothing leaked from the machinery
  if (/\b(json|segment|utterance|phase|prompt|tag)\b/i.test(q)) reasons.push("mentions the machinery");

  return { ok: reasons.length === 0, reasons };
}
