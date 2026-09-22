import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { ArchiveShell, LoadingBlock, metadata } from "@/components/archive-shell";
import { DestinationCard } from "@/components/ui/card-21";
import { STATE_LABEL, isBusy, useProcessing } from "@/lib/processing";
import { RequireSession } from "@/components/require-session";
import { BackLink } from "@/components/nav-arrows";
import { SearchPanel } from "@/components/search-panel";
import { TierCards } from "@/components/tier-cards";
import { RecordStoryDialog, type DialogMode } from "@/components/record-story";
import { displayName, useSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { search, supabase, type MediaAsset, type SearchResult, type Segment, type Vault } from "@/lib/supabase";
import { signedUrls } from "@/lib/transcript";
import { say } from "@/lib/interviewer";
import { formatTime } from "@/lib/playSegment";
import { fmtDate, humanDuration } from "@/lib/format";

export const Route = createFileRoute("/vault/$vaultId")({
  ssr: false,
  head: () => metadata("Archive Vault — LegaSeen", "Explore preserved interviews and filmed family memories."),
  component: VaultPage,
});

async function loadVault(vaultId: string) {
  const { data: v } = await supabase.from("vaults").select("id,name,subject_name,description").eq("id", vaultId).maybeSingle();
  const { data: m } = await supabase.from("media_assets").select("*")
    .eq("vault_id", vaultId).in("media_type", ["video", "audio"]).order("created_at");
  const { data: s } = await supabase.from("story_segments").select("*").eq("vault_id", vaultId).order("start_seconds");
  const interviews = (m ?? []) as MediaAsset[];
  const posters = await signedUrls("interview-videos", interviews.map((x) => `${vaultId}/${x.id}-poster.jpg`));
  return { vault: (v ?? null) as Vault | null, interviews, segments: (s ?? []) as Segment[], posters };
}

function VaultPage() {
  return <RequireSession><VaultPageInner /></RequireSession>;
}

function VaultPageInner() {
  const { vaultId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["vault", vaultId], queryFn: () => loadVault(vaultId), staleTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [recMode, setRecMode] = useState<DialogMode>("choose");
  const queryClient = useQueryClient();
  const { session } = useSession();

  // Pipeline progress for each recording; when one finishes, reload the vault
  // so its chapters and poster appear without a refresh.
  const mediaIds = (data?.interviews ?? []).map((m) => m.id);
  const processing = useProcessing(vaultId, mediaIds);
  const wasBusy = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(Object.entries(processing.data ?? {}).filter(([, st]) => isBusy(st)).map(([id]) => id));
    const finished = [...wasBusy.current].some((id) => !now.has(id));
    wasBusy.current = now;
    if (finished) void queryClient.invalidateQueries({ queryKey: ["vault", vaultId] });
  }, [processing.data, queryClient, vaultId]);

  if (isLoading || !data) return <ArchiveShell vaultId={vaultId}><LoadingBlock label="Unlocking the vault…" /></ArchiveShell>;
  const { vault, interviews, segments, posters } = data;
  if (!vault) return <ArchiveShell><LoadingBlock label="This vault is not in your custody." /></ArchiveShell>;

  const bySource = new Map<string, Segment[]>();
  for (const s of segments) bySource.set(s.source_media_id, [...(bySource.get(s.source_media_id) ?? []), s]);
  const totalSeconds = interviews.reduce((n, m) => n + (m.duration_seconds ?? 0), 0)
    || segments.reduce((n, s) => n + (s.end_seconds - s.start_seconds), 0);
  const present = new Set(segments.flatMap((s) => s.emotions));
  const year = interviews[0] ? new Date(interviews[0].created_at).getFullYear() : new Date().getFullYear();

  // Vault-wide search: the hit tells us which interview to open, and where.
  async function run(body: { query?: string; emotion?: string; audio?: Blob | null; speak?: boolean }) {
    setBusy(true); setResult(null);
    try {
      const r = await search({ vault_id: vault!.id, ...body });
      setResult(r);
      // The spoken answer plays here, before the reel opens.
      if (r.audio_b64) await say("", r.audio_b64);
      if (!("crisis" in r) && r.found) {
        navigate({ to: "/screening/$mediaId", params: { mediaId: r.segment.source_media_id }, search: { seg: r.segment.id } });
      }
    } catch (e) {
      setResult({ found: false, segment: null, message: String(e) });
    } finally { setBusy(false); }
  }

  return (
    <ArchiveShell vaultId={vaultId}>
      <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
        <BackLink label="the archive" link={{ to: "/" }} />
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-end">
          <div>
            <p className="eyebrow">Archive vault · {interviews.length} recording{interviews.length === 1 ? "" : "s"} · {humanDuration(totalSeconds)}</p>
            <h1 className="mt-2 font-display text-4xl font-bold leading-tight text-navy sm:text-5xl">{vault.name}</h1>
            <p className="mt-2 text-base text-muted-foreground">
              <span className="font-semibold text-navy">{vault.subject_name}</span> · {segments.length} stories · recorded {year}
            </p>
          </div>
          <div>
            <SearchPanel dense present={present} busy={busy} result={result}
                         onAsk={(a) => run(a)} onFeeling={(f, speak) => run({ emotion: f, speak })} />
          </div>
        </div>

        {interviews.length === 0 && (
          <TierCards vault={vault} custodian={displayName(session)} onRecord={(m) => { setRecMode(m); setRecOpen(true); }} />
        )}
        <RecordStoryDialog vault={vault} custodian={displayName(session)} open={recOpen} mode={recMode} onOpenChange={setRecOpen}
                           onSaved={async () => {
                             setRecOpen(false);
                             await queryClient.invalidateQueries({ queryKey: ["vault", vaultId] });
                             await queryClient.invalidateQueries({ queryKey: ["vaults"] });
                           }} />

        <div className="mt-6 flex items-center justify-between">
          <p className="eyebrow">{interviews.length ? "Recordings in this vault" : "Recordings"}</p>
          <Button variant="outline" size="sm" onClick={() => { setRecMode("choose"); setRecOpen(true); }}><Plus /> Add a recording</Button>
        </div>
        {interviews.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Nothing recorded yet — choose a path above.</p>}
        <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {interviews.map((m, index) => {
            const segs = bySource.get(m.id) ?? [];
            const st = processing.data?.[m.id] ?? null;
            const stats = isBusy(st)
              ? `${STATE_LABEL[st!.state]}… · Recorded ${fmtDate(m.created_at)}`
              : st?.state === "failed"
                ? `Processing failed · Recorded ${fmtDate(m.created_at)}`
                : segs.length
                  ? `${segs.length} chapter${segs.length === 1 ? "" : "s"} · Recorded ${fmtDate(m.created_at)}`
                  : st?.state === "done"
                    ? `Transcribed · Recorded ${fmtDate(m.created_at)}`
                    : `Awaiting processing · Recorded ${fmtDate(m.created_at)}`;
            return (
              <div key={m.id} className="relative">
                {isBusy(st) && (
                  <span className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-navy/80 px-3 py-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ivory">
                    <span className="size-1.5 animate-pulse rounded-full bg-gold" /> {STATE_LABEL[st!.state]}
                  </span>
                )}
                <DestinationCard layout="frame"
                  imageUrl={posters[`${vaultId}/${m.id}-poster.jpg`] ?? null}
                  eyebrow={`Reel ${String(index + 1).padStart(2, "0")}${m.duration_seconds != null ? ` · ${formatTime(m.duration_seconds)}` : ""}`}
                  title={m.title}
                  stats={stats}
                  cta="Open recording"
                  link={{ to: "/screening/$mediaId", params: { mediaId: m.id } }}
                  themeColor="228 70% 20%"
                />
              </div>
            );
          })}
        </div>
      </section>
    </ArchiveShell>
  );
}
