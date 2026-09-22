/**
 * Ears and voice, shared by the interviewer and search: Scribe in, ElevenLabs
 * out. Kept in one place so both functions transcribe and speak identically.
 */
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

import { langByCode, normaliseLang } from "./languages.ts";

const SCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/** Scribe, same model and settings as the batch pipeline. Detects the language unless told. */
export async function transcribe(audio: ArrayBuffer, mime: string, apiKey: string, language = "auto"): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime }), `clip.${mime.includes("mp4") ? "mp4" : "webm"}`);
  form.append("model_id", Deno.env.get("ELEVENLABS_STT_MODEL")?.trim() || "scribe_v2");
  form.append("tag_audio_events", "false");
  if (language && language !== "auto") form.append("language_code", language);
  const res = await fetch(SCRIBE_URL, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  if (!res.ok) throw new Error(`Scribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { text: (data.text ?? "").trim(), language: normaliseLang(data.language_code) };
}

export function decodeAudio(b64: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

/**
 * ElevenLabs TTS → base64 MP3, or null when no voice is configured or it
 * fails (speech is a courtesy; the text is always there too). Picks
 * multilingual_v2 for the languages it covers and v3 for the rest.
 */
export async function speak(text: string, apiKey: string, language = "en"): Promise<string | null> {
  const voice = Deno.env.get("ELEVENLABS_VOICE_ID")?.trim();
  if (!voice || !text.trim()) return null;
  const model = Deno.env.get("ELEVENLABS_TTS_MODEL")?.trim() || langByCode(language)?.tts || "eleven_multilingual_v2";
  try {
    const res = await fetch(`${TTS_URL}/${voice}?output_format=mp3_22050_32`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text, model_id: model,
        // Steady and a touch slower than default: this is said to an elder.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, speed: 0.95 },
      }),
    });
    if (!res.ok) { console.error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
    return encodeBase64(await res.arrayBuffer());
  } catch (e) {
    console.error("TTS failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
