import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, SkipForward, Square, Volume2, VolumeX } from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { DeleteRecordingButton } from "@/components/delete-recording";
import { LANGUAGES, askNextQuestion, say, stopSpeaking, type PhaseInfo, type Turn, type VoiceSink } from "@/lib/interviewer";
import { SOFT_LIMIT_BYTES, clock, mb, uploadRecording } from "@/lib/media-upload";
import { supabase } from "@/lib/supabase";

type State = "idle" | "thinking" | "speaking" | "listening" | "finishing" | "saved";
type Crisis = { message: string; resources: { name: string; phone: string; detail: string }[] } | null;

/** Shown before the session begins, so they know the shape of it. Mirrors the server's guide. */
const PARTS = [
  "Getting settled", "Where you came from", "Growing up", "Becoming yourself", "Work and purpose",
  "Love and family", "The world around you", "Turning points", "Looking back", "A message for the family",
];

function pickVideoMime(): string {
  const c = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  return c.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
}
function pickAudioMime(): string {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  return c.find((t) => MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
}

/**
 * A guided recording session. One continuous video recorder runs for the whole
 * sitting — that file is what lands in the vault. A second, audio-only recorder
 * is started after the interviewer finishes speaking and stopped when they
 * finish answering, so each answer can be transcribed and the next question
 * follows what was actually said.
 */
export function GuidedInterview({ vaultId, subjectName, onSaved, onExit }: {
  vaultId: string; subjectName: string; onSaved: (mediaId: string) => void; onExit: () => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [question, setQuestion] = useState<string>("");
  const [intro, setIntro] = useState<string>("");
  const [bridge, setBridge] = useState<string>("");
  const [part, setPart] = useState<PhaseInfo | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [language, setLanguage] = useState<string>("auto");
  const langRef = useRef("auto");
  langRef.current = language;
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<Crisis>(null);
  const [lastHeard, setLastHeard] = useState<string>("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRecRef = useRef<MediaRecorder | null>(null);
  const videoChunks = useRef<Blob[]>([]);
  const sinkRef = useRef<VoiceSink | null>(null);
  const answerRecRef = useRef<MediaRecorder | null>(null);
  const answerChunks = useRef<Blob[]>([]);
  const startedAt = useRef<number>(0);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const skippedRef = useRef<string[]>([]);
  skippedRef.current = skipped;
  const voiceRef = useRef(true);
  voiceRef.current = voiceOn;

  const release = useCallback(() => {
    stopSpeaking();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    sinkRef.current?.ctx.close().catch(() => {});
    sinkRef.current = null;
  }, []);
  useEffect(() => () => release(), [release]);

  useEffect(() => {
    if (state !== "listening" && state !== "speaking") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state]);

  /** Start the audio-only recorder for one answer. */
  function startAnswerRecorder() {
    const stream = streamRef.current;
    if (!stream) return;
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const rec = new MediaRecorder(audioOnly, { mimeType: pickAudioMime(), audioBitsPerSecond: 64_000 });
    answerChunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) answerChunks.current.push(e.data); };
    rec.start();
    answerRecRef.current = rec;
  }

  function stopAnswerRecorder(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = answerRecRef.current;
      if (!rec || rec.state === "inactive") return resolve(new Blob([], { type: pickAudioMime() }));
      rec.onstop = () => resolve(new Blob(answerChunks.current, { type: pickAudioMime() }));
      rec.stop();
    });
  }

  async function begin() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: true,
      });
      streamRef.current = stream;
      if (liveRef.current) { liveRef.current.srcObject = stream; await liveRef.current.play().catch(() => {}); }
    } catch (e) {
      return setErr(e instanceof Error && e.name === "NotAllowedError"
        ? "Camera and microphone access was refused. Allow it in the browser's address bar and try again."
        : `Could not open the camera: ${e instanceof Error ? e.message : String(e)}`);
    }

    // The archive recording is the camera plus a MIX of the microphone and the
    // interviewer's voice, so her questions are in the video. The per-answer
    // clips (below) stay microphone-only so her voice is never transcribed as
    // the answer.
    const ctx = new AudioContext();
    const recording = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(streamRef.current!).connect(recording);
    sinkRef.current = { ctx, recording };
    const mixed = new MediaStream([...streamRef.current!.getVideoTracks(), ...recording.stream.getAudioTracks()]);

    // One recorder for the whole sitting.
    const vrec = new MediaRecorder(mixed, { mimeType: pickVideoMime(), videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
    videoChunks.current = [];
    vrec.ondataavailable = (e) => { if (e.data.size) { videoChunks.current.push(e.data); setBytes((b) => b + e.data.size); } };
    vrec.start(1000);
    videoRecRef.current = vrec;
    startedAt.current = Date.now();

    await advance(null);
  }

  /** Send the answer just recorded (if any), then speak and show the next question. */
  async function advance(audio: Blob | null) {
    setState("thinking");
    try {
      const reply = await askNextQuestion({ vaultId, history: turnsRef.current, skipped: skippedRef.current, language: langRef.current, audio });

      if ("crisis" in reply && reply.crisis) {
        setCrisis({ message: reply.message, resources: reply.resources });
        setState("idle");
        return;
      }
      if (reply.transcript) {
        setLastHeard(reply.transcript);
        setTurns((prev) => prev.length === 0 ? prev : [...prev.slice(0, -1), { ...prev[prev.length - 1]!, answer: reply.transcript }]);
      }
      setPart(reply.phase);
      if (!reply.done && reply.skipped) { skippedRef.current = reply.skipped; setSkipped(reply.skipped); }
      // "auto" resolves on the first answer; pin it for the rest of the session.
      if (reply.language && reply.language !== langRef.current) { langRef.current = reply.language; setLanguage(reply.language); }

      if (reply.done || !reply.question) {
        setQuestion(reply.say);
        setState("speaking");
        if (voiceRef.current) await say(reply.say, reply.audio_b64, sinkRef.current ?? undefined);
        await finish();
        return;
      }

      setIntro(reply.intro ?? "");
      setBridge(reply.bridge ?? "");
      setQuestion(reply.question);
      const turn: Turn = {
        question: reply.question, answer: "", phase: reply.phase.id,
        startedAt: Math.round((Date.now() - startedAt.current) / 1000),
        ...(reply.topic ? { topic: reply.topic } : {}),
      };
      setTurns((prev) => [...prev, turn]);

      // Let the interviewer finish before we start listening, so its own voice
      // isn't transcribed as her answer.
      setState("speaking");
      if (voiceRef.current) await say(reply.say, reply.audio_b64, sinkRef.current ?? undefined);
      startAnswerRecorder();
      setState("listening");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState(turnsRef.current.length ? "listening" : "idle");
    }
  }

  async function nextQuestion() {
    stopSpeaking();
    const audio = await stopAnswerRecorder();
    await advance(audio);
  }

  /** They'd rather not do this part: send what was said, mark it skipped, move on. */
  async function skipPart() {
    if (!part) return;
    stopSpeaking();
    const audio = await stopAnswerRecorder();
    const next = [...skippedRef.current, part.id];
    skippedRef.current = next;
    setSkipped(next);
    await advance(audio);
  }

  async function finish() {
    stopSpeaking();
    setState("finishing");
    try {
      await stopAnswerRecorder();
      const vrec = videoRecRef.current;
      const video: Blob = await new Promise((resolve) => {
        if (!vrec || vrec.state === "inactive") return resolve(new Blob(videoChunks.current, { type: pickVideoMime() }));
        vrec.onstop = () => resolve(new Blob(videoChunks.current, { type: pickVideoMime() }));
        vrec.stop();
      });
      release();

      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      const title = `Guided session, ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
      const mediaId = await uploadRecording(vaultId, video, pickVideoMime(), title, seconds);

      // The questions, their parts and timestamps travel with the recording,
      // so the archive can use them as chapter hints later.
      const plan = {
        version: 2, media_id: mediaId, vault_id: vaultId, subject: subjectName,
        recorded_at: new Date().toISOString(), duration_seconds: seconds, skipped: skippedRef.current, language: langRef.current,
        turns: turnsRef.current.map((t) => ({ at: t.startedAt, phase: t.phase, question: t.question, topic: t.topic ?? null, answer: t.answer })),
      };
      await supabase.storage.from("interview-videos")
        .upload(`${vaultId}/${mediaId}.interview.json`, new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
                { contentType: "application/json", upsert: true });

      setSavedId(mediaId);
      setState("saved");
      onSaved(mediaId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("listening");
    }
  }

  const answered = turns.filter((t) => t.answer).length;
  const live = state === "listening" || state === "speaking" || state === "thinking";

  if (crisis) {
    return (
      <div className="rounded-2xl border-2 border-destructive bg-card p-6">
        <p className="font-display text-xl font-bold text-destructive">Let&apos;s stop the recording there.</p>
        <p className="mt-2 text-sm leading-7 text-foreground">{crisis.message}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {crisis.resources.map((r) => (
            <a key={r.name} href={`tel:${r.phone.replace(/\s/g, "")}`} className="rounded-full bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground">
              {r.name} {r.phone}
            </a>
          ))}
        </div>
        <Button variant="outline" className="mt-5" onClick={() => { release(); onExit(); }}>Close</Button>
      </div>
    );
  }

  return (
    <div>
      {err && <p role="alert" className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

      {/* Where we are in the session */}
      {live && part && (
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-gold-strong">
              Part {part.index + 1} of {part.total} · <span className="text-navy">{part.title}</span>
            </p>
            <span className="text-[0.62rem] uppercase tracking-[0.13em] text-muted-foreground">
              {answered} answer{answered === 1 ? "" : "s"} · {clock(elapsed)}
            </span>
          </div>
          <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${part.total}, 1fr)` }}>
            {PARTS.map((_, i) => (
              <span key={i} className={`h-1 rounded-full ${i < part.index ? "bg-gold" : i === part.index ? "bg-navy" : "bg-border"}`} />
            ))}
          </div>
        </div>
      )}

      <div className="relative aspect-video overflow-hidden rounded-xl bg-navy">
        <video ref={liveRef} muted playsInline className="size-full object-cover" />

        {state === "idle" && (
          <div className="absolute inset-0 overflow-y-auto bg-navy/85 px-6 py-6 text-ivory sm:px-10">
            <p className="font-display text-2xl">An interviewer will sit with {subjectName}</p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ivory/75">
              It welcomes her, then asks one question at a time and follows her answers through the parts of a life.
              About 45 minutes for the whole thing — stop whenever you like, and skip any part she&apos;d rather not do.
            </p>
            <ol className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ivory/85 sm:grid-cols-5">
              {PARTS.map((p, i) => (
                <li key={p} className="flex gap-2"><span className="font-bold text-gold">{i + 1}</span><span>{p}</span></li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-gold">
                Her language
                <select value={language} onChange={(e) => setLanguage(e.target.value)}
                        className="h-9 rounded-md border border-ivory/30 bg-navy px-2 text-sm font-medium normal-case tracking-normal text-ivory">
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.code === "auto" ? `${l.name} — ${l.native}` : `${l.name} · ${l.native}`}</option>
                  ))}
                </select>
              </label>
              <Button onClick={begin} className="bg-gold text-navy hover:bg-gold-strong"><Mic /> Begin the session</Button>
            </div>
          </div>
        )}

        {live && question && (
          <div className="absolute inset-x-0 bottom-0 max-h-[70%] overflow-y-auto bg-gradient-to-t from-navy via-navy/92 to-transparent px-6 pb-6 pt-16">
            {intro && turns.length === 1 && (
              <p className="mb-3 max-w-2xl text-sm leading-6 text-ivory/80">{intro}</p>
            )}
            {bridge && <p className="mb-1 text-sm italic text-ivory/70">{bridge}</p>}
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-gold">
              Question {turns.length}{language !== "auto" && language !== "en" ? ` · ${LANGUAGES.find((l) => l.code === language)?.name ?? language}` : ""}{state === "thinking" ? " · thinking…" : state === "speaking" ? " · speaking" : ""}
            </p>
            <p lang={language === "auto" ? undefined : language} className="mt-1 font-display text-2xl leading-snug text-ivory sm:text-3xl">{question}</p>
          </div>
        )}

        {(state === "listening" || state === "speaking") && (
          <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-ivory">
            <span className="size-2 animate-pulse rounded-full bg-red-500" /> REC {clock(elapsed)} · {mb(bytes)}
          </span>
        )}
        {state === "thinking" && (
          <span className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-ivory">
            <Loader2 className="size-3 animate-spin" /> listening back…
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === "listening" && (
          <>
            <Button onClick={nextQuestion} className="bg-gold text-navy hover:bg-gold-strong"><Check /> I&apos;ve finished answering</Button>
            <Button variant="outline" onClick={skipPart} title="Move on to the next part of the session"><SkipForward /> Skip this part</Button>
            <Button variant="ghost" onClick={finish}><Square /> End &amp; save</Button>
          </>
        )}
        {state === "speaking" && (
          <Button variant="outline" onClick={() => { stopSpeaking(); }}><Volume2 className="animate-pulse" /> Interviewer is speaking… (click to skip)</Button>
        )}
        {state === "thinking" && <Button disabled variant="outline"><Loader2 className="animate-spin" /> Thinking of the next question…</Button>}
        {state === "finishing" && <Button disabled variant="outline"><Loader2 className="animate-spin" /> Saving the session…</Button>}
        {state === "saved" && (
          <>
            <p className="text-sm font-semibold text-green-700">Saved to the vault. The archive is indexing it now.</p>
            {savedId && (
              <DeleteRecordingButton media={{ id: savedId, vault_id: vaultId }} title="this session" label="Discard it instead"
                onDeleted={async () => {
                  await queryClient.invalidateQueries({ queryKey: ["vault", vaultId] });
                  await queryClient.invalidateQueries({ queryKey: ["vaults"] });
                  onExit();
                }} />
            )}
          </>
        )}

        {live && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setVoiceOn((v) => { if (v) stopSpeaking(); return !v; })}>
            {voiceOn ? <Volume2 /> : <VolumeX />} {voiceOn ? "Voice on" : "Voice off"}
          </Button>
        )}
      </div>

      {lastHeard && live && (
        <p className="mt-3 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs leading-6 text-muted-foreground">
          <span className="font-bold uppercase tracking-[0.13em] text-gold-strong">Heard</span> — {lastHeard.slice(0, 220)}{lastHeard.length > 220 ? "…" : ""}
        </p>
      )}
      {bytes > SOFT_LIMIT_BYTES && (
        <p className="mt-2 text-xs text-destructive">This session is over 50 MB, which the archive&apos;s storage may refuse. Consider ending and saving it.</p>
      )}
    </div>
  );
}
