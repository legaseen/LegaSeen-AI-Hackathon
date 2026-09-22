import { useEffect, useState } from "react";
import { Mic, MicOff, Search, Square, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FEELINGS, feelingLabel } from "@/lib/format";
import type { SearchResult } from "@/lib/supabase";
import { useSpokenAnswers, useVoiceInput } from "@/lib/voice";

/** "How are you feeling today?" box + feeling chips + result card, in the archive's own styling. */
export type Ask = { query?: string; emotion?: string; audio?: Blob | null; speak: boolean };

export function SearchPanel({ present, busy, onAsk, onFeeling, result, placeholder, busyLabel, dense, label }: {
  present: Set<string>;
  dense?: boolean;
  label?: string;
  busy: boolean;
  /** Typed or spoken; `speak` says whether the answer should be read aloud. */
  onAsk: (ask: Ask) => void;
  onFeeling: (feeling: string, speak: boolean) => void;
  result: SearchResult | null;
  placeholder?: string;
  busyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const voice = useVoiceInput();
  const [speak, setSpeak] = useSpokenAnswers();
  const listening = voice.state === "listening";

  // A spoken question shows up in the box as if typed.
  useEffect(() => { if (result?.transcript) setQuery(result.transcript); }, [result]);

  async function toggleMic() {
    if (listening) {
      const clip = await voice.stop();
      if (clip) { setQuery(""); onAsk({ audio: clip, speak }); }
    } else {
      await voice.start();
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) onAsk({ query: query.trim(), speak }); }}
        className={`${dense ? "" : "mt-5 "}flex items-center gap-3 rounded-full border bg-card px-5 shadow-paper focus-within:border-gold ${listening ? "border-red-500" : "border-input"}`}
      >
        {label && <span className="eyebrow shrink-0 whitespace-nowrap">{label}</span>}
        <Search className="size-4 text-primary" />
        <input value={listening ? "" : query} onChange={(e) => setQuery(e.target.value)} readOnly={listening}
               className="h-12 w-full bg-transparent text-sm outline-none"
               placeholder={listening ? `Listening… ${voice.seconds}s — tap the square when you've finished` : (placeholder ?? "How are you feeling today?")} />
        {voice.state !== "unsupported" && (
          <Button type="button" size="icon" variant={listening ? "default" : "ghost"} onClick={toggleMic} disabled={busy}
                  aria-label={listening ? "Finish speaking" : "Ask by voice"}
                  title={voice.state === "denied" ? "Microphone access was refused — allow it in the address bar" : listening ? "Finish" : "Ask by voice"}
                  className={`size-9 shrink-0 rounded-full ${listening ? "bg-red-600 text-white hover:bg-red-700" : "text-primary"}`}>
            {listening ? <Square className="size-4" /> : voice.state === "denied" ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>
        )}
        <Button type="button" size="icon" variant="ghost" onClick={() => setSpeak(!speak)} aria-pressed={speak}
                aria-label={speak ? "Answers are read aloud" : "Answers are silent"} title={speak ? "Read answers aloud · on" : "Read answers aloud · off"}
                className="size-9 shrink-0 rounded-full text-muted-foreground">
          {speak ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </Button>
        <Button type="submit" size="sm" disabled={busy || listening || !query.trim()} className="rounded-full bg-gold px-5 text-navy hover:bg-gold-strong">Ask</Button>
      </form>
      <div className="mt-4">
        <p className="eyebrow">Start with a feeling</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FEELINGS.map((tag) => {
            const has = present.has(tag);
            return (
              <button key={tag} type="button" onClick={() => onFeeling(tag, speak)} disabled={busy || !has}
                      title={has ? `Find a story for feeling ${feelingLabel(tag).toLowerCase()}` : "No story tagged this yet"}
                      className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                        has
                          ? "border-border bg-card text-navy shadow-paper hover:border-navy hover:bg-navy hover:text-ivory disabled:opacity-60"
                          : "cursor-not-allowed border-dashed border-border/70 bg-transparent text-muted-foreground/50"}`}>
                {feelingLabel(tag)}
              </button>
            );
          })}
        </div>
      </div>

      {busy && <p className="eyebrow mt-6">{busyLabel ?? "Looking through her stories…"}</p>}
      {result && <ResultCard result={result} />}
    </>
  );
}

export function ResultCard({ result }: { result: SearchResult }) {
  if ("crisis" in result) {
    return (
      <section className="mt-6 rounded-2xl border-2 border-destructive bg-card p-6 shadow-paper">
        <p className="font-display text-lg font-bold text-destructive">We&apos;re not going to show you a story right now.</p>
        <p className="mt-2 text-sm leading-6 text-foreground">{result.message}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {result.resources.map((r) => (
            <a key={r.name} href={`tel:${r.phone.replace(/\s/g, "")}`}
               className="rounded-full bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground">
              {r.name} {r.phone}
            </a>
          ))}
        </div>
      </section>
    );
  }
  if (!result.found) {
    return <section className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-paper">{result.message}</section>;
  }
  return (
    <section className="mt-6 rounded-2xl border border-gold bg-card p-5 shadow-paper">
      <p className="eyebrow">She has something for you{result.cached ? " · from memory" : ""}{result.transcript ? " · you asked aloud" : ""}</p>
      <p className="mt-2 font-display text-lg leading-7 text-navy">{humanReason(result.reason)}</p>
    </section>
  );
}

/** The emotion path answers with the raw tag ("…feeling FeelingAlone"); show it as words. */
function humanReason(reason: string) {
  return reason.replace(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g, (m) => feelingLabel(m).toLowerCase());
}
