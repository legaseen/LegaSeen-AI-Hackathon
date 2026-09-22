import { useEffect, useRef, useState } from "react";
import { Check, Home, Mic, RotateCcw, Sparkles, Square, Upload, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type Vault } from "@/lib/supabase";
import { requestLink } from "@/components/tier-cards";
import { SOFT_LIMIT_BYTES, clock as fmt, durationOf, mb, uploadRecording } from "@/lib/media-upload";
import { GuidedInterview } from "@/components/guided-interview";

export type RecordMode = "record" | "upload" | "guided";
export type DialogMode = "choose" | RecordMode;

const MAX_SECONDS = 10 * 60;

function pickMime(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
}

export function RecordStoryDialog({ vault, custodian, open, mode, onOpenChange, onSaved }: {
  vault: Vault; custodian: string; open: boolean; mode: DialogMode;
  onOpenChange: (open: boolean) => void; onSaved: (mediaId: string) => void;
}) {
  const [step, setStep] = useState<DialogMode>(mode);
  useEffect(() => { if (open) setStep(mode); }, [open, mode]);
  const subjectName = vault.subject_name;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === "choose" || step === "guided" ? "sm:max-w-3xl" : "sm:max-w-2xl"}>
        {step === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl text-navy">Add a recording to {subjectName}&apos;s vault</DialogTitle>
              <DialogDescription>Choose how the stories get recorded. Every path ends as a recording in this vault, indexed into chapters with a transcript.</DialogDescription>
            </DialogHeader>
            <div className="mt-2 grid gap-4 sm:grid-cols-3">
              <TierOption icon={Home} label="Premium · Concierge" title="We come to them"
                          blurb={`Our crew films ${subjectName} at home for one to two hours and delivers an edited documentary and transcript here.`}>
                <Button asChild className="w-full bg-gold text-navy hover:bg-gold-strong"><a href={requestLink("Premium concierge visit", vault, custodian)}>Request a home visit</a></Button>
              </TierOption>
              <TierOption icon={Video} label="Mid-range · Online" title="Interview over Zoom"
                          blurb="The same guided interview over a video call with one of our interviewers, edited and delivered here.">
                <Button asChild variant="outline" className="w-full"><a href={requestLink("Zoom interview session", vault, custodian)}>Book a Zoom session</a></Button>
              </TierOption>
              <TierOption icon={Mic} label="Self-serve" title="Record it yourselves"
                          blurb={`An interviewer asks ${subjectName} a question at a time and follows the answers — or just record freely.`}>
                <div className="grid gap-2">
                  <Button onClick={() => setStep("guided")} className="w-full bg-gold text-navy hover:bg-gold-strong"><Sparkles /> Guided interview</Button>
                  <Button onClick={() => setStep("record")} variant="outline" className="w-full"><Video /> Just record</Button>
                  <Button onClick={() => setStep("upload")} variant="outline" className="w-full"><Upload /> Upload a video</Button>
                </div>
              </TierOption>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl text-navy">
                {step === "guided" ? "Guided interview" : step === "record" ? "Record a story" : "Upload a video"} for {subjectName}&apos;s vault
              </DialogTitle>
              <DialogDescription>It is stored privately in the vault and indexed by the archive.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>← All options</Button>
              <span className="mx-1 h-4 w-px bg-border" />
              <Button size="sm" variant={step === "guided" ? "default" : "outline"} onClick={() => setStep("guided")}><Sparkles /> Guided</Button>
              <Button size="sm" variant={step === "record" ? "default" : "outline"} onClick={() => setStep("record")}><Video /> Just record</Button>
              <Button size="sm" variant={step === "upload" ? "default" : "outline"} onClick={() => setStep("upload")}><Upload /> Upload</Button>
            </div>
            {open && (step === "guided"
              ? <GuidedInterview vaultId={vault.id} subjectName={subjectName} onSaved={onSaved} onExit={() => setStep("choose")} />
              : step === "record"
                ? <Recorder vaultId={vault.id} onSaved={onSaved} />
                : <Uploader vaultId={vault.id} onSaved={onSaved} />)}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TierOption({ icon: Icon, label, title, blurb, children }: {
  icon: typeof Home; label: string; title: string; blurb: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-background p-4">
      <span className="grid size-9 place-items-center rounded-md bg-secondary text-primary"><Icon className="size-4" /></span>
      <p className="eyebrow mt-3">{label}</p>
      <h3 className="mt-1 font-display text-lg font-bold text-navy">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{blurb}</p>
      <div className="mt-auto pt-4">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ record */

function Recorder({ vaultId, onSaved }: { vaultId: string; onSaved: (id: string) => void }) {
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<"idle" | "ready" | "recording" | "review" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const mime = pickMime();

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => () => { releaseCamera(); if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function openCamera() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: true,
      });
      streamRef.current = stream;
      if (liveRef.current) { liveRef.current.srcObject = stream; await liveRef.current.play().catch(() => {}); }
      setPhase("ready");
    } catch (e) {
      setErr(e instanceof Error && e.name === "NotAllowedError"
        ? "Camera and microphone access was refused. Allow it in the browser's address bar and try again."
        : `Could not open the camera: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function start() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = []; setBytes(0); setElapsed(0);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
    rec.ondataavailable = (e) => { if (e.data.size) { chunksRef.current.push(e.data); setBytes((b) => b + e.data.size); } };
    rec.onstop = () => {
      const b = new Blob(chunksRef.current, { type: mime });
      setBlob(b); setPreviewUrl(URL.createObjectURL(b)); setPhase("review");
      releaseCamera();
    };
    rec.start(1000);
    recRef.current = rec;
    setPhase("recording");
  }

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => { if (phase === "recording" && elapsed >= MAX_SECONDS) stop(); }, [elapsed, phase]);  // eslint-disable-line react-hooks/exhaustive-deps

  function stop() { if (recRef.current?.state === "recording") recRef.current.stop(); }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setBlob(null); setPreviewUrl(null); setElapsed(0); setBytes(0); setPhase("idle");
  }

  async function save() {
    if (!blob) return;
    const t = title.trim() || `Story recorded ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
    setPhase("saving"); setErr(null);
    try { onSaved(await uploadRecording(vaultId, blob, mime, t, elapsed || null)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase("review"); }
  }

  return (
    <div className="mt-4">
      {err && <p role="alert" className="mb-3 border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}
      <div className="relative aspect-video overflow-hidden bg-navy">
        {phase === "review" || phase === "saving"
          ? <video src={previewUrl ?? undefined} controls playsInline className="size-full" />
          : <video ref={liveRef} muted playsInline className="size-full object-cover" />}
        {phase === "idle" && (
          <div className="absolute inset-0 grid place-items-center">
            <Button onClick={openCamera} className="bg-gold text-navy hover:bg-gold-strong"><Video /> Open camera</Button>
          </div>
        )}
        {phase === "recording" && (
          <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-ivory">
            <span className="size-2 animate-pulse rounded-full bg-red-500" /> REC {fmt(elapsed)} · {mb(bytes)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {phase === "ready" && <Button onClick={start} className="bg-red-600 text-white hover:bg-red-700"><span className="size-3 rounded-full bg-white" /> Start recording</Button>}
        {phase === "recording" && <Button onClick={stop} variant="outline"><Square /> Stop</Button>}
        {(phase === "review" || phase === "saving") && (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give this story a title (optional)"
                   className="h-10 min-w-0 flex-1 border border-input bg-background px-3 text-sm outline-none focus:border-gold" />
            <Button variant="outline" onClick={retake} disabled={phase === "saving"}><RotateCcw /> Re-take</Button>
            <Button onClick={save} disabled={phase === "saving"} className="bg-gold text-navy hover:bg-gold-strong">
              <Check /> {phase === "saving" ? "Saving…" : "Save to vault"}
            </Button>
          </>
        )}
        <span className="ml-auto text-[0.62rem] uppercase tracking-[0.13em] text-muted-foreground">
          {phase === "recording" ? `up to ${fmt(MAX_SECONDS)}` : phase === "review" ? `${fmt(elapsed)} · ${mb(blob?.size ?? 0)}` : mime.split(";")[0]}
        </span>
      </div>
      {blob && blob.size > SOFT_LIMIT_BYTES && (
        <p className="mt-2 text-xs text-destructive">This recording is over 50 MB, which the archive's storage may refuse. Re-take a shorter story if the save fails.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ upload */

function Uploader({ vaultId, onSaved }: { vaultId: string; onSaved: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function choose(f: File | null) {
    setErr(null); setFile(f); setDuration(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    if (f) { setTitle((t) => t || f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")); setDuration(await durationOf(f)); }
  }

  async function save() {
    if (!file) return;
    setBusy(true); setErr(null);
    try { onSaved(await uploadRecording(vaultId, file, file.type || "video/mp4", title.trim() || file.name, duration)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <div className="mt-4">
      {err && <p role="alert" className="mb-3 border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}
      <label className="flex aspect-video cursor-pointer flex-col items-center justify-center border-2 border-dashed border-border bg-background text-center hover:border-gold">
        {previewUrl
          ? <video src={previewUrl} controls playsInline className="size-full bg-navy" />
          : <><Upload className="size-8 text-primary" /><span className="mt-3 text-sm font-semibold text-navy">Choose a video from this device</span><span className="mt-1 text-xs text-muted-foreground">MP4, MOV or WebM · up to about 50 MB</span></>}
        <input type="file" accept="video/*" className="sr-only" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
      </label>
      {file && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
                 className="h-10 min-w-0 flex-1 border border-input bg-background px-3 text-sm outline-none focus:border-gold" />
          <Button variant="outline" onClick={() => choose(null)} disabled={busy}><RotateCcw /> Change</Button>
          <Button onClick={save} disabled={busy} className="bg-gold text-navy hover:bg-gold-strong"><Check /> {busy ? "Saving…" : "Save to vault"}</Button>
          <span className="ml-auto text-[0.62rem] uppercase tracking-[0.13em] text-muted-foreground">{duration != null ? `${fmt(duration)} · ` : ""}{mb(file.size)}</span>
        </div>
      )}
      {file && file.size > SOFT_LIMIT_BYTES && <p className="mt-2 text-xs text-destructive">This file is over 50 MB, which the archive's storage may refuse.</p>}
    </div>
  );
}
