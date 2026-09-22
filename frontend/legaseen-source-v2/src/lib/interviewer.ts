import { supabase } from "./supabase";

export type Turn = { question: string; answer: string; phase: string; topic?: string; startedAt: number };

export type PhaseInfo = { index: number; id: string; title: string; total: number; turns: number };

/** Languages offered at the start of a session. Mirrors _shared/languages.ts on the server. */
export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: "auto", name: "Let her choose", native: "detected from her first answer" },
  { code: "en", name: "English", native: "English" }, { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "it", name: "Italian", native: "Italiano" }, { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "zh", name: "Mandarin", native: "普通话" }, { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" }, { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" }, { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ur", name: "Urdu", native: "اردو" }, { code: "es", name: "Spanish", native: "Español" },
  { code: "tl", name: "Filipino", native: "Filipino" }, { code: "ko", name: "Korean", native: "한국어" },
  { code: "ja", name: "Japanese", native: "日本語" }, { code: "de", name: "German", native: "Deutsch" },
  { code: "fr", name: "French", native: "Français" }, { code: "pl", name: "Polish", native: "Polski" },
  { code: "hr", name: "Croatian", native: "Hrvatski" }, { code: "sr", name: "Serbian", native: "Српски" },
  { code: "mk", name: "Macedonian", native: "Македонски" }, { code: "ru", name: "Russian", native: "Русский" },
  { code: "tr", name: "Turkish", native: "Türkçe" }, { code: "fa", name: "Persian", native: "فارسی" },
  { code: "pt", name: "Portuguese", native: "Português" }, { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
];

export type InterviewReply =
  | { crisis: true; message: string; resources: { name: string; phone: string; detail: string }[]; transcript: string; language?: string }
  | { crisis?: false; done: true; question: null; say: string; message: string; transcript: string; language: string; phase: PhaseInfo; audio_b64?: string | null }
  | { crisis?: false; done: false; question: string; say: string; intro?: string; bridge?: string; topic?: string; transcript: string; language: string; phase: PhaseInfo; skipped?: string[]; audio_b64?: string | null };

/** Base64 without blowing the stack on a multi-MB clip. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Ask the interviewer for its next question. Pass the audio of the answer just
 * given and it is transcribed first, so the question follows what was said.
 */
export async function askNextQuestion(args: {
  vaultId: string; history: Turn[]; skipped: string[]; language: string; audio?: Blob | null; mime?: string;
}): Promise<InterviewReply> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not signed in");

  const body: Record<string, unknown> = {
    vault_id: args.vaultId,
    history: args.history.map((t) => ({ question: t.question, answer: t.answer, phase: t.phase })),
    skipped: args.skipped,
    language: args.language,
  };
  if (args.audio && args.audio.size > 0) {
    body["audio"] = await toBase64(args.audio);
    body["mime"] = args.mime ?? args.audio.type ?? "audio/webm";
  }

  const res = await fetch(import.meta.env["VITE_INTERVIEW_URL"], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env["VITE_SUPABASE_ANON_KEY"],
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `interviewer returned ${res.status}`);
  return data as InterviewReply;
}

/** Where the interviewer's voice goes: the speakers, and into the recording. */
export type VoiceSink = { ctx: AudioContext; recording: MediaStreamAudioDestinationNode };

let current: { stop: () => void } | null = null;

function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Say something aloud and resolve when it has finished.
 *
 * With a `sink`, the MP3 is decoded and played through Web Audio into BOTH the
 * speakers and the recording's audio destination — so the questions are in
 * the archive video no matter what the microphone hears (echo cancellation
 * strips the speakers from the mic, which is how a whole session was once
 * saved with answers and no questions). Without a sink, or with no MP3, it
 * falls back to a plain element or the browser's own voice.
 */
export function say(text: string, audioB64?: string | null, sink?: VoiceSink): Promise<void> {
  stopSpeaking();
  if (audioB64 && sink) {
    return new Promise((resolve) => {
      sink.ctx.decodeAudioData(b64ToBytes(audioB64)).then((buffer) => {
        const src = sink.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(sink.ctx.destination);
        src.connect(sink.recording);
        let done = false;
        const finish = () => { if (!done) { done = true; current = null; resolve(); } };
        src.onended = finish;
        current = { stop: () => { try { src.stop(); } catch { /* already stopped */ } finish(); } };
        src.start();
      }).catch(() => { current = null; resolve(); });
    });
  }
  if (audioB64) {
    return new Promise((resolve) => {
      const a = new Audio(`data:audio/mpeg;base64,${audioB64}`);
      current = { stop: () => { a.pause(); } };
      a.onended = () => { current = null; resolve(); };
      a.onerror = () => { current = null; resolve(); };
      a.play().catch(() => { current = null; resolve(); });
    });
  }
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    const preferred = speechSynthesis.getVoices().find((v) => /en-(GB|AU)/i.test(v.lang) && /female|samantha|karen|serena/i.test(v.name))
      ?? speechSynthesis.getVoices().find((v) => /en-(GB|AU|US)/i.test(v.lang));
    if (preferred) u.voice = preferred;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (current) { const c = current; current = null; c.stop(); }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
