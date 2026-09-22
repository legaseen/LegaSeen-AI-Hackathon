// Safety test for the shared crisis filter. Patterns are read out of
// crisis.ts, so this cannot drift from what ships.
//
//   node supabase/functions/_shared/crisis.test.mjs
//
// A false negative shows a video clip — or asks a follow-up question — of
// someone in crisis. Treat any failure here as blocking.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "crisis.ts"), "utf8");
const block = src.split("export const CRISIS_PATTERNS: RegExp[] = [")[1].split("];")[0];
const PATTERNS = block
  .split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/"))
  .map((l) => { const m = l.match(/^\/(.*)\/([a-z]*),?$/); return new RegExp(m[1], m[2]); });

const normalise = (t) => t.replace(/[‘’ʼ՚]/g, "'");
const isCrisis = (t) => PATTERNS.some((r) => r.test(normalise(t)));

const MUST_FLAG = [
  "i want to kill myself", "I want to die", "kms", "thinking about suicide",
  "i feel suicidal", "i want to end it all", "ending my life",
  "i want to take my own life", "everyone would be better off dead",
  "i dont want to be here anymore", "i don't want to live",
  // Regression: Scribe returned this from real audio and the interview
  // function's trimmed copy of the list missed it entirely.
  "Honestly love, some days I don't want to live anymore",
  "some days I don’t want to live",        // typographic apostrophe
  "i have been hurting myself", "i keep harming myself", "self harm",
  "i cut myself", "i want to hurt myself", "there is no reason to live",
  "nothing to live for", "i took an overdose",
];

// Ordinary searches and ordinary answers an elder might give.
const MUST_NOT_FLAG = [
  "i feel alone", "im scared about my future", "i miss my grandmother",
  "i failed my exam and feel like a fraud", "my girlfriend broke up with me",
  "how did she cope when her husband died", "tell me about the depression",
  "i am dead tired", "this assignment is killing me", "i could die of embarrassment",
  "what did they eat when there was nothing", "grief", "i feel lost",
  "i hurt my ankle", "she hurt herself falling", "this is cutting it close",
  "my husband died in 1978", "we had nothing but we had each other",
  "i'd rather not talk about that", "i'm very tired now",
];

let failures = 0;
for (const t of MUST_FLAG) {
  if (!isCrisis(t)) { failures++; console.error(`  FAIL (missed crisis): ${JSON.stringify(t)}`); }
}
for (const t of MUST_NOT_FLAG) {
  if (isCrisis(t)) { failures++; console.error(`  FAIL (false positive): ${JSON.stringify(t)}`); }
}

const total = MUST_FLAG.length + MUST_NOT_FLAG.length;
console.log(`${PATTERNS.length} patterns, ${total} cases, ${failures} failure(s)`);
if (failures) process.exit(1);
console.log("crisis filter OK");
