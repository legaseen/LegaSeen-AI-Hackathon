import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Download, FileText, ListVideo, Loader2, Pause, Play, X } from "lucide-react";

import { ArchiveShell, LoadingBlock, Still, metadata } from "@/components/archive-shell";
import { ResultCard, SearchPanel } from "@/components/search-panel";
import { Button } from "@/components/ui/button";
import { RequireSession } from "@/components/require-session";
import { BackLink, Pager } from "@/components/nav-arrows";
import { DeleteRecordingButton } from "@/components/delete-recording";
import { STATE_LABEL, isBusy, useProcessing } from "@/lib/processing";
import { canEditVault, search, signedVideoUrl, supabase, type MediaAsset, type SearchResult, type Segment, type Vault } from "@/lib/supabase";
import { fetchSidecar, signedUrl, signedUrls, useSyncedTranscript, type Chapter, type Sidecar } from "@/lib/transcript";
import { formatTime, playSegment } from "@/lib/playSegment";
import { fmtDate } from "@/lib/format";
import { say } from "@/lib/interviewer";

type ScreeningSearch = { seg?: string };
type PanelState = "open" | "collapsed" | "closed";

function ResultCardSlot({ result }: { result: SearchResult }) { return <ResultCard result={result} />; }

export const Route = createFileRoute("/screening/$mediaId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): ScreeningSearch =>
    typeof s["seg"] === "string" ? { seg: s["seg"] } : {},
  head: () => metadata("Archival testimony — LegaSeen", "Watch an archival testimony with its synchronized transcript and connected photographs."),
  component: ScreeningPage,
});

async function loadInterview(mediaId: string) {
  const { data: m } = await supabase.from("media_assets").select("*").eq("id", mediaId).maybeSingle();
  const media = (m ?? null) as MediaAsset | null;
  if (!media) return null;
  const { data: v } = await supabase.from("vaults").select("id,name,subject_name,description").eq("id", media.vault_id).maybeSingle();
  const { data: s } = await supabase.from("story_segments").select("*").eq("source_media_id", mediaId).order("start_seconds");
  const { data: sib } = await supabase.from("media_assets").select("id,title,created_at")
    .eq("vault_id", media.vault_id).in("media_type", ["video", "audio"]).order("created_at");
  const siblings = (sib ?? []) as Pick<MediaAsset, "id" | "title" | "created_at">[];
  let videoUrl: string | null = null;
  try { videoUrl = await signedVideoUrl(media.storage_path); } catch { /* shown as missing */ }
  const sidecar = await fetchSidecar(media.vault_id, media.id);
  const captionsUrl = sidecar ? await signedUrl("interview-videos", sidecar.captions_path) : null;
  const captionsEnUrl = sidecar?.captions_en_path ? await signedUrl("interview-videos", sidecar.captions_en_path) : null;
  const thumbs = sidecar
    ? await signedUrls("interview-videos", sidecar.chapters.map((c) => c.thumbnail_path).filter((p): p is string => !!p))
    : {};
  const photoUrls = sidecar ? await signedUrls("archival-photos", sidecar.photo_moments.map((p) => p.storage_path)) : {};
  const canEdit = await canEditVault(media.vault_id);
  return { media, vault: (v ?? null) as Vault | null, segments: (s ?? []) as Segment[], siblings, videoUrl, sidecar, captionsUrl, captionsEnUrl, thumbs, photoUrls, canEdit };
}

function ScreeningPage() {
  return <RequireSession><ScreeningPageInner /></RequireSession>;
}

function ScreeningPageInner() {
  const { mediaId } = Route.useParams();
  const { seg: initialSegId } = Route.useSearch();
  const { data, isLoading } = useQuery({ queryKey: ["interview", mediaId], queryFn: () => loadInterview(mediaId), staleTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false });

  if (isLoading) return <ArchiveShell><LoadingBlock label="Threading the reel…" /></ArchiveShell>;
  if (!data || !data.vault) return <ArchiveShell><LoadingBlock label="This testimony is not in your custody." /></ArchiveShell>;
  return <Screening {...data} vault={data.vault} initialSegId={initialSegId ?? null} />;
}

function Screening({ media, vault, segments, siblings, videoUrl, sidecar, captionsUrl, captionsEnUrl, thumbs, photoUrls, canEdit, initialSegId }: {
  media: MediaAsset; vault: Vault; segments: Segment[]; siblings: Pick<MediaAsset, "id" | "title" | "created_at">[];
  videoUrl: string | null; sidecar: Sidecar | null;
  captionsUrl: string | null; captionsEnUrl: string | null; thumbs: Record<string, string>; photoUrls: Record<string, string>; canEdit: boolean; initialSegId: string | null;
}) {
  const initial = initialSegId ? segments.find((s) => s.id === initialSegId) ?? null : null;
  const [activeId, setActiveId] = useState<string | null>(initial?.id ?? null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [chaptersPanel, setChaptersPanel] = useState<PanelState>("collapsed");
  const [transcriptPanel, setTranscriptPanel] = useState<PanelState>("collapsed");
  const [photosOpen, setPhotosOpen] = useState(false);
  // A recording in another language carries an English track for the family.
  const english = sidecar?.translations?.["en"] ?? null;
  const [showEnglish, setShowEnglish] = useState(false);
  const pendingSeek = useRef<{ start: number; end: number } | null>(
    initial ? { start: initial.start_seconds, end: initial.end_seconds } : null);
  const panelRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // While the archive is still indexing this recording, follow its progress
  // and reload once it is published.
  const processing = useProcessing(vault.id, sidecar ? [] : [media.id]);
  const status = processing.data?.[media.id] ?? null;
  const seenBusy = useRef(false);
  useEffect(() => {
    if (isBusy(status)) { seenBusy.current = true; return; }
    if (seenBusy.current && status?.state === "done") {
      seenBusy.current = false;
      void queryClient.invalidateQueries({ queryKey: ["interview", media.id] });
      void queryClient.invalidateQueries({ queryKey: ["vault", vault.id] });
    }
  }, [status, queryClient, media.id, vault.id]);

  const utterances = sidecar?.utterances ?? [];
  const chapters: Chapter[] = sidecar?.chapters ?? [];
  const currentIdx = useSyncedTranscript(videoEl, utterances);
  const active = activeId ? segments.find((s) => s.id === activeId) ?? null : null;
  const activeChapter = chapters.find((c) => c.segment_id === activeId) ?? null;
  const activeIndex = active ? segments.findIndex((s) => s.id === active.id) : -1;

  // A seek can be requested before the <video> exists (arriving from a vault-wide search).
  useEffect(() => {
    if (videoEl && pendingSeek.current) {
      playSegment(videoEl, { start_seconds: pendingSeek.current.start, end_seconds: pendingSeek.current.end });
      pendingSeek.current = null;
    }
  }, [videoEl]);

  // Keep the spoken block in view — scroll the panel, never the page.
  useEffect(() => {
    const panel = panelRef.current, el = blockRefs.current[currentIdx];
    if (!panel || !el) return;
    const top = el.offsetTop - panel.offsetTop;
    panel.scrollTo({ top: Math.max(0, top - panel.clientHeight / 2 + el.clientHeight / 2), behavior: "smooth" });
  }, [currentIdx]);

  const play = useCallback((s: { id: string; start_seconds: number; end_seconds: number }) => {
    setActiveId(s.id);
    if (videoEl) playSegment(videoEl, s);
    else pendingSeek.current = { start: s.start_seconds, end: s.end_seconds };
  }, [videoEl]);

  const seekTo = useCallback((seconds: number) => {
    if (!videoEl) return;
    videoEl.currentTime = Math.max(0, seconds - 0.3);
    void videoEl.play().catch(() => {});
  }, [videoEl]);

  const stepChapter = useCallback((dir: -1 | 1) => {
    if (chapters.length === 0) return;
    const cur = chapters.findIndex((c) => c.segment_id === activeId);
    const next = chapters[Math.min(chapters.length - 1, Math.max(0, (cur < 0 ? (dir > 0 ? -1 : chapters.length) : cur) + dir))];
    if (next) play({ id: next.segment_id, start_seconds: next.start_seconds, end_seconds: next.end_seconds });
  }, [chapters, activeId, play]);

  // ← / → step chapters unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); stepChapter(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); stepChapter(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepChapter]);

  const sibIndex = siblings.findIndex((x) => x.id === media.id);
  const prevSib = sibIndex > 0 ? siblings[sibIndex - 1] : null;
  const nextSib = sibIndex >= 0 && sibIndex < siblings.length - 1 ? siblings[sibIndex + 1] : null;
  const chapterIndex = chapters.findIndex((c) => c.segment_id === activeId);

  async function run(body: { query?: string; emotion?: string; audio?: Blob | null; speak?: boolean }) {
    setBusy(true); setResult(null);
    try {
      const r = await search({ vault_id: vault.id, media_id: media.id, ...body });
      setResult(r);
      if ("crisis" in r) { videoEl?.pause(); setActiveId(null); }
      // She says why this story is for you, then the clip begins.
      if (r.audio_b64) { videoEl?.pause(); await say("", r.audio_b64); }
      if (!("crisis" in r) && r.found) play(r.segment);
    } catch (e) {
      setResult({ found: false, segment: null, message: String(e) });
    } finally { setBusy(false); }
  }

  const crisis = !!result && "crisis" in result;
  const present = new Set(segments.flatMap((s) => s.emotions));
  const chapterFor = (n: number) => chapters.find((c) => c.utterances && n >= c.utterances[0] && n <= c.utterances[1]) ?? null;
  const isPlaying = !!videoEl && !videoEl.paused;

  return (
    <ArchiveShell vaultId={vault.id}>
      <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <BackLink label={vault.name} link={{ to: "/vault/$vaultId", params: { vaultId: vault.id } }} />
            <span className="hidden text-[0.62rem] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:inline">
              {media.title} · recorded {fmtDate(media.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && <DeleteRecordingButton media={media} title={media.title} onDeleted={async () => {
              await queryClient.invalidateQueries({ queryKey: ["vault", vault.id] });
              await queryClient.invalidateQueries({ queryKey: ["vaults"] });
              queryClient.removeQueries({ queryKey: ["interview", media.id] });
              await navigate({ to: "/vault/$vaultId", params: { vaultId: vault.id } });
            }} />}
            <Pager label="Recording" index={Math.max(0, sibIndex)} total={siblings.length}
                   prevLink={prevSib ? { to: "/screening/$mediaId", params: { mediaId: prevSib.id } } : null}
                   nextLink={nextSib ? { to: "/screening/$mediaId", params: { mediaId: nextSib.id } } : null} />
          </div>
        </div>

        <div className="mt-3">
          <SearchPanel dense label={`Ask ${vault.subject_name}`} present={present} busy={busy} result={result}
                       placeholder={`Ask ${vault.subject_name} anything…`} busyLabel="Listening back through the reel…"
                       onAsk={(a) => run(a)} onFeeling={(f, speak) => run({ emotion: f, speak })} />
        </div>

        {!sidecar && segments.length === 0 && (
          <p className="mt-4 flex items-center gap-3 border border-gold bg-secondary px-4 py-3 text-sm text-navy">
            {isBusy(status) ? (
              <><Loader2 className="size-4 shrink-0 animate-spin text-gold-strong" />
                <span><span className="font-bold">{STATE_LABEL[status!.state]}…</span> The archive is indexing this recording now. Chapters, the
                synchronized transcript and search will appear here as soon as it&apos;s done.</span></>
            ) : status?.state === "failed" ? (
              <span><span className="font-bold">Processing failed.</span> The recording is safe in the vault; the archive couldn&apos;t index it
                {status.error ? ` — ${status.error.split("\n").pop()}` : "."}</span>
            ) : (
              <span><span className="font-bold">Awaiting processing.</span> This recording is safely in the vault. Chapters, the synchronized
                transcript and search appear once the archive has indexed it.</span>
            )}
          </p>
        )}

        {/* The player is never rendered alongside a crisis response. */}
        {!crisis && (
          <>
            <div className="mt-4 flex items-center justify-end gap-2">
              <div className="flex gap-1.5">
                <Button size="sm" variant={chaptersPanel === "closed" ? "outline" : "default"} onClick={() => setChaptersPanel((s) => (s === "closed" ? "open" : "closed"))}>
                  <ListVideo /> Chapters
                </Button>
                <Button size="sm" variant={transcriptPanel === "closed" ? "outline" : "default"} onClick={() => setTranscriptPanel((s) => (s === "closed" ? "open" : "closed"))}>
                  <FileText /> Transcript
                </Button>
              </div>
            </div>

            <div className={`mt-3 grid gap-6 lg:items-stretch ${transcriptPanel === "open" ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,.9fr)]" : ""}`}>
              <div className="min-w-0">
                <div className="relative overflow-hidden rounded-2xl border border-border bg-navy shadow-paper">
                  {videoUrl ? (
                    <video ref={setVideoEl} src={videoUrl} controls playsInline crossOrigin="anonymous" className="block w-full bg-black">
                      {captionsUrl && <track key={showEnglish && captionsEnUrl ? "en" : "orig"} kind="captions" default
                                              srcLang={showEnglish && captionsEnUrl ? "en" : (sidecar?.language ?? "en")}
                                              label={showEnglish && captionsEnUrl ? "English" : "Original"}
                                              src={showEnglish && captionsEnUrl ? captionsEnUrl : captionsUrl} />}
                    </video>
                  ) : <p className="p-8 text-sm text-ivory/70">The master for this testimony could not be loaded.</p>}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-navy/95 px-4 py-2.5 text-[0.6rem] font-bold uppercase tracking-[0.13em] text-ivory">
                    <span>{active ? `${formatTime(active.start_seconds)} – ${formatTime(active.end_seconds)}` : "Select a chapter"}</span>
                    <div className="[&_button]:border-ivory/25 [&_button]:bg-transparent [&_button]:text-ivory [&_button:hover]:bg-ivory/10 [&_span]:text-ivory/70">
                      <Pager label="Chapter" index={Math.max(0, chapterIndex)} total={chapters.length} compact
                             onPrev={() => stepChapter(-1)} onNext={() => stepChapter(1)} />
                    </div>
                    <span className="hidden sm:inline">{media.duration_seconds != null ? formatTime(media.duration_seconds) : ""}{sidecar ? ` · ${sidecar.language}` : ""} · ← → keys step chapters</span>
                  </div>
                </div>

                {chaptersPanel !== "closed" && (
                  <div className="mt-3 rounded-2xl border border-border bg-card shadow-paper">
                    <PanelHeader title="Chapters" sub={`${chapters.length} indexed`} state={chaptersPanel}
                                 onToggle={() => setChaptersPanel((s) => (s === "open" ? "collapsed" : "open"))}
                                 onClose={() => setChaptersPanel("closed")} />
                    {chaptersPanel === "open" && (
                      <div className="px-3 pb-3">
                        {chapters.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No chapters have been indexed for this recording yet.</p>}
                        {chapters.map((c, i) => {
                          const isActive = active?.id === c.segment_id;
                          const thumb = c.thumbnail_path ? thumbs[c.thumbnail_path] : undefined;
                          return (
                            <button key={c.segment_id} type="button"
                                    onClick={() => play({ id: c.segment_id, start_seconds: c.start_seconds, end_seconds: c.end_seconds })}
                                    className={`mt-2 flex w-full items-center gap-3 border-t border-border pt-2 text-left ${isActive ? "text-gold-strong" : "text-primary hover:text-gold-strong"}`}>
                              <span className="text-xs">{isActive && isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}</span>
                              <span className="hidden h-9 w-14 shrink-0 overflow-hidden rounded bg-navy sm:block">
                                {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold">{String(i + 1).padStart(2, "0")} · {c.title}</span>
                                <span className="block truncate text-[0.62rem] text-muted-foreground">{formatTime(c.start_seconds)} · {c.hook ?? c.summary}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {transcriptPanel !== "closed" && (
                <aside className="flex min-h-0 flex-col rounded-2xl border border-border bg-card shadow-paper lg:max-h-[calc(100vh-14rem)]">
                  <PanelHeader title="Verbatim testimonial record"
                               sub={`Transcript & synchronized notes · sync ${isPlaying ? "live" : "paused"}`} state={transcriptPanel}
                               onToggle={() => setTranscriptPanel((s) => (s === "open" ? "collapsed" : "open"))}
                               onClose={() => setTranscriptPanel("closed")} />
                  {transcriptPanel === "open" && (
                    <>
                      {english && (
                        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
                          <span className="eyebrow mr-2 text-[0.55rem]">Read in</span>
                          <Button size="sm" variant={showEnglish ? "outline" : "default"} className="h-7 px-2.5 text-xs" onClick={() => setShowEnglish(false)}>
                            Her words{sidecar?.language ? ` · ${sidecar.language}` : ""}
                          </Button>
                          <Button size="sm" variant={showEnglish ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setShowEnglish(true)}>
                            English
                          </Button>
                        </div>
                      )}
                      <div ref={panelRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-4 pt-3 text-sm leading-7" style={{ maxHeight: 720 }}>
                        {!sidecar && <p className="text-xs text-muted-foreground">No transcript has been published for this testimony yet.</p>}
                        {utterances.map((u, i) => {
                          const sp = sidecar?.speakers[u.speaker];
                          const isNow = i === currentIdx;
                          const isQuote = activeChapter?.quote?.utterance === u.n;
                          const ch = chapterFor(u.n);
                          const subject = sp?.role === "subject";
                          return (
                            <button key={u.n} type="button" ref={(el) => { blockRefs.current[i] = el; }} onClick={() => seekTo(u.start)}
                                    className={`block w-full border-l-2 pl-3 text-left transition-colors ${isNow ? "border-gold bg-secondary/60" : "border-transparent hover:bg-secondary/40"}`}>
                              {ch?.utterances && ch.utterances[0] === u.n && <span className="eyebrow block text-[0.55rem]">▸ {ch.title}</span>}
                              <span className="mr-4 font-bold text-primary">{formatTime(u.start)}</span>
                              <b className={subject ? "text-navy" : "text-muted-foreground"}>{sp?.label ?? u.speaker}:</b>
                              {isQuote && <span className="chip-active ml-2 px-2 py-0.5 text-[0.5rem]">Archival highlight</span>}
                              <p lang={showEnglish && english ? "en" : (sidecar?.language ?? undefined)}
                                 className={`mt-1 ${isQuote ? "font-display italic text-navy" : subject ? "text-foreground" : "text-muted-foreground"}`}>
                                {(() => { const t = showEnglish && english ? (english[String(u.n)] ?? u.text) : u.text; return isQuote ? `“${t}”` : t; })()}
                              </p>
                              {showEnglish && english && english[String(u.n)] && (
                                <p lang={sidecar?.language ?? undefined} className="mt-0.5 text-xs italic text-muted-foreground/80">{u.text}</p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {captionsUrl && (
                        <a href={captionsUrl} download="transcript.vtt" className="mx-5 mb-4 inline-flex items-center gap-2 border-t border-border pt-3 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-primary hover:text-gold-strong">
                          <Download className="size-3" /> Download transcript
                        </a>
                      )}
                    </>
                  )}
                </aside>
              )}
            </div>
          </>
        )}

        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-paper">
          <p className="eyebrow">{active ? `Now playing · Chapter ${activeIndex + 1} of ${segments.length}` : "About this recording"}</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-navy">{active ? active.title : media.title}</h1>
          <p className="mt-1 font-display italic text-muted-foreground">{vault.subject_name}{active ? ` · ${formatTime(active.start_seconds)} – ${formatTime(active.end_seconds)}` : ` · recorded ${fmtDate(media.created_at)}`}</p>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground">{active?.summary ?? vault.description ?? "A private recording in this vault."}</p>
          {active && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {[...active.emotions, ...active.wisdom_tags, ...active.topics].slice(0, 6).map((t) => (
                <span key={t} className="rounded-md bg-secondary px-2 py-1 text-[0.6rem] font-bold uppercase tracking-wide text-primary">#{t}</span>
              ))}
              {active.era.map((e) => <span key={e} className="rounded-md bg-secondary px-2 py-1 text-[0.6rem] font-bold uppercase tracking-wide text-primary">{e}</span>)}
            </div>
          )}
        </section>

        {sidecar && sidecar.photo_moments.length > 0 && !crisis && (
          <section className="mt-10">
            <button type="button" onClick={() => setPhotosOpen((o) => !o)}
                    aria-expanded={photosOpen}
                    className="flex w-full items-end justify-between gap-4 border-b border-gold pb-3 text-left">
              <span>
                <span className="eyebrow">Archival folio cross-references</span>
                <span className="mt-2 block font-display text-3xl font-bold uppercase text-primary">
                  Mentioned &amp; connected archival photographs
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 pb-1 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                {sidecar.photo_moments.length} photograph{sidecar.photo_moments.length === 1 ? "" : "s"}
                {photosOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </span>
            </button>

            {photosOpen && (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  Click any timestamp to jump to the moment {vault.subject_name} speaks about it.
                </p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {sidecar.photo_moments.map((p, i) => (
                    <article key={p.photo_id} className="rounded-xl border border-border bg-card p-3 shadow-paper">
                      <Still src={photoUrls[p.storage_path]} crop={(i % 6) + 1} alt={p.title} />
                      <h3 className="mt-3 text-sm font-bold text-navy">{p.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{p.blurb ? `“${p.blurb}”` : "Family archive"}{p.taken_year ? ` · ${p.taken_year}` : ""}</p>
                      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => seekTo(p.seconds)}>
                        <Play /> {formatTime(p.seconds)} · Jump to reel moment
                      </Button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <div className="mt-9 flex flex-col items-start justify-between gap-5 rounded-2xl border border-border bg-card p-6 shadow-paper sm:flex-row sm:items-center">
          <div>
            <p className="eyebrow">Family archive gallery</p>
            <h2 className="font-display text-2xl font-bold text-primary">The family gallery</h2>
          </div>
          <Button asChild><Link to="/gallery/$vaultId" params={{ vaultId: vault.id }}>Open the gallery <ArrowRight /></Link></Button>
        </div>
      </section>
    </ArchiveShell>
  );
}

function PanelHeader({ title, sub, state, onToggle, onClose }: {
  title: string; sub?: string; state: PanelState; onToggle: () => void; onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <button type="button" onClick={onToggle} className="min-w-0 text-left">
        <p className="eyebrow">{title}</p>
        {sub && state === "open" && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="icon" variant="ghost" className="size-7" onClick={onToggle} aria-label={state === "open" ? `Collapse ${title}` : `Expand ${title}`}>
          {state === "open" ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label={`Close ${title}`}><X className="size-4" /></Button>
      </div>
    </div>
  );
}
