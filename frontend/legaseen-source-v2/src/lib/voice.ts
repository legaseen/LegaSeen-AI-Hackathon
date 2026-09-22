import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "listening" | "denied" | "unsupported";

function pickMime(): string {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  return c.find((t) => MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
}

/**
 * Tap to start listening, tap to finish: the clip comes back as a Blob for
 * Scribe. The microphone is only open between the two taps, and released
 * when the component goes away.
 */
export function useVoiceInput() {
  const [state, setState] = useState<VoiceState>(typeof MediaRecorder === "undefined" ? "unsupported" : "idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }, []);
  useEffect(() => () => release(), [release]);

  useEffect(() => {
    if (state !== "listening") { setSeconds(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(async () => {
    if (state === "listening") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: pickMime(), audioBitsPerSecond: 64_000 });
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.start();
      recRef.current = rec;
      setState("listening");
    } catch (e) {
      setState(e instanceof Error && e.name === "NotAllowedError" ? "denied" : "unsupported");
    }
  }, [state]);

  /** Resolves with the clip; null if nothing was captured. */
  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec || rec.state === "inactive") { release(); setState("idle"); return resolve(null); }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: pickMime() });
        release(); setState("idle");
        resolve(blob.size > 0 ? blob : null);
      };
      rec.stop();
    });
  }, [release]);

  return { state, seconds, start, stop };
}

const SPEAK_KEY = "legaseen.spoken-answers";

/** Whether answers are read aloud; remembered per browser. Defaults on. */
export function useSpokenAnswers(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try { return localStorage.getItem(SPEAK_KEY) !== "off"; } catch { return true; }
  });
  const set = useCallback((v: boolean) => {
    setOn(v);
    try { localStorage.setItem(SPEAK_KEY, v ? "on" : "off"); } catch { /* private mode */ }
  }, []);
  return [on, set];
}
