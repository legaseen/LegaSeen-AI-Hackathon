// Offline unit test for the question guardrail:
//   deno run supabase/functions/_shared/guard.test.ts
import { vetQuestion } from "./guard.ts";

const prev = ["What did your mother's sewing corner look like?"];
const CASES: [string, { question: string; bridge?: string }, string, boolean][] = [
  ["good english", { question: "What did the kitchen smell like on a Sunday?" }, "en", true],
  ["two questions", { question: "Where were you born? And what was the house like?" }, "en", false],
  ["yes/no", { question: "Did you like school?" }, "en", false],
  ["too long", { question: "Could you tell me, in as much detail as you can remember, about the very first house that you lived in as a child and who lived there with you and what it looked like?" }, "en", false],
  ["repeat", { question: "What did your mother's sewing corner look like" }, "en", false],
  ["near repeat", { question: "What did your mother's sewing corner look like, then?" }, "en", false],
  ["bridge asks", { question: "What was school like?", bridge: "Shall we talk about school?" }, "en", false],
  ["greek ok", { question: "Πώς ήταν το σπίτι όπου μεγαλώσατε;" }, "el", true],
  ["greek but english", { question: "What was the house like?" }, "el", false],
  ["hindi ok", { question: "आपका बचपन का घर कैसा था?" }, "hi", true],
  ["telugu ok", { question: "మీరు పెరిగిన ఇల్లు ఎలా ఉండేది?" }, "te", true],
  ["chinese ok", { question: "您小时候住的房子是什么样的？" }, "zh", true],
  ["chinese too long", { question: "您能不能尽可能详细地告诉我您小时候住的第一所房子是什么样子的，谁和您一起住在那里，房子周围有什么，您最喜欢哪个房间，为什么？" }, "zh", false],
  ["vietnamese ok", { question: "Ngôi nhà thời thơ ấu của bác trông như thế nào?" }, "vi", true],
  ["machinery leak", { question: "Which segment of your childhood should we tag next?" }, "en", false],
];
let fails = 0;
for (const [name, draft, lang, want] of CASES) {
  const v = vetQuestion(draft, lang, prev);
  const ok = v.ok === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(18)} ok=${v.ok}${v.reasons.length ? "  (" + v.reasons.join("; ") + ")" : ""}`);
}
console.log(fails ? `${fails} FAILURE(S)` : `question guard OK (${CASES.length} cases)`);
if (fails) Deno.exit(1);
