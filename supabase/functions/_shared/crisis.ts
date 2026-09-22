/**
 * The crisis filter. ONE definition, imported by every function that sees
 * words typed or spoken by a person.
 *
 * This file exists because the list was once copied into a second function and
 * quietly lost four patterns — including "don't want to live" — so a real
 * disclosure was answered with a follow-up question. Never inline these
 * patterns anywhere; import from here.
 *
 * Deliberately broad: a false positive costs one search, a false negative
 * shows a video clip to someone in crisis.
 */
export const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill|killing)\s+(myself|my\s?self)\b/i,
  /\bk+m+s+\b/i,
  /\bsuicid(e|al)\b/i,
  /\bend(ing)?\s+(it|my\s+life)\b/i,
  /\btake\s+my\s+(own\s+)?life\b/i,
  /\b(want|wanna|going)\s+to\s+die\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+here|live|exist)\b/i,
  /\b(hurt|harm|cut)\w*\s+(myself|my\s?self)\b/i,
  /\bself[\s-]?harm/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on)\b/i,
  /\bnothing\s+to\s+live\s+for\b/i,
  /\boverdos(e|ing)\b/i,
];

/** Australian crisis lines. Returned instead of a story — never alongside one. */
export const CRISIS_RESOURCES = [
  { name: "Lifeline", phone: "13 11 14", detail: "24/7 crisis support" },
  { name: "Kids Helpline", phone: "1800 55 1800", detail: "24/7, for ages 5-25" },
];

export const CRISIS_MESSAGE =
  "It sounds like you're going through something really heavy right now. " +
  "A story isn't the right thing to offer you at this moment — please talk to " +
  "someone who can help.";

export const CRISIS_MESSAGE_INTERVIEW =
  "Let's pause the recording there. What you've just said matters more than the " +
  "interview — please talk to someone who can help.";

/** Transcribers and keyboards both produce typographic apostrophes; fold them first. */
export function normalise(text: string): string {
  return text.replace(/[‘’ʼ՚]/g, "'");
}

export function isCrisis(text: string): boolean {
  const t = normalise(text);
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

/**
 * The regex above only reads English. For everything else — and as a second
 * opinion in English — ask a small model.
 *
 * Fails CLOSED: any API or parse error throws. A safety check that quietly
 * returns false on error is worse than none (it once did, for every call,
 * because OpenAI's JSON mode wants the word "JSON" in the prompt).
 */
export async function llmCrisis(text: string, apiKey: string): Promise<boolean> {
  if (!text.trim()) return false;
  const model = Deno.env.get("OPENAI_SEARCH_MODEL")?.trim() || "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          "You read one utterance from an elderly person recording their life story, in any language. " +
          "Answer in JSON. Return {\"crisis\": true} ONLY if the speaker expresses, about themselves and in the present, suicidal thoughts, " +
          "a wish to die or not be alive, or intent to harm themselves. Grief, sadness, loneliness, talk of others who died, " +
          "or the past (\"I wanted to die back then\") are NOT crisis. Otherwise return {\"crisis\": false}." },
        { role: "user", content: text.slice(0, 2000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`crisis check failed: OpenAI ${res.status} ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  if (typeof parsed.crisis !== "boolean") throw new Error("crisis check returned no verdict");
  return parsed.crisis;
}
