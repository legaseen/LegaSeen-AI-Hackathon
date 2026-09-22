import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FolderOpen, Mic, StickyNote, Upload } from "lucide-react";

import { ArchiveShell, LoadingBlock, Still, metadata } from "@/components/archive-shell";
import { RequireSession } from "@/components/require-session";
import { BackLink } from "@/components/nav-arrows";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase, type MediaAsset, type Segment, type Vault } from "@/lib/supabase";
import { signedUrls } from "@/lib/transcript";
import { formatTime } from "@/lib/playSegment";
import { UploadMediaDialog } from "@/components/upload-media";

export const Route = createFileRoute("/gallery/$vaultId")({
  ssr: false,
  head: () => metadata("Gallery — LegaSeen", "Browse catalogued photographs and the oral histories they connect to."),
  component: GalleryPage,
});

type Photo = MediaAsset & { caption: string | null; taken_year: number | null };
type Moment = { photo_id: string; seconds: number; blurb: string; segment_id: string | null; media_id: string; folder: string | null };

async function loadPhotos(vaultId: string) {
  const { data: v } = await supabase.from("vaults").select("id,name,subject_name,description").eq("id", vaultId).maybeSingle();
  const { data: p } = await supabase.from("media_assets").select("*")
    .eq("vault_id", vaultId).eq("media_type", "photo").order("taken_year", { ascending: true, nullsFirst: false });
  const { data: seg } = await supabase.from("story_segments").select("*").eq("vault_id", vaultId).not("related_photo_id", "is", null);
  const { data: rec } = await supabase.from("media_assets").select("id")
    .eq("vault_id", vaultId).in("media_type", ["video", "audio"]).order("created_at");

  const photos = (p ?? []) as Photo[];
  const urls = await signedUrls("archival-photos", photos.map((x) => x.storage_path));

  // Moments live in each recording's sidecar; collect them so a photo can link
  // straight to the second it is spoken about.
  const moments: Moment[] = [];
  const sidecarUrls = await signedUrls("interview-videos", (rec ?? []).map((r) => `${vaultId}/${r.id}.transcript.json`));
  await Promise.all(Object.entries(sidecarUrls).map(async ([path, url]) => {
    const mediaId = path.split("/")[1]?.replace(".transcript.json", "") ?? "";
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const sc = await res.json();
      // Folder names come from the chapter a photo belongs to, so the folio is
      // grouped by story rather than by an arbitrary field.
      const chapterFolder = new Map<string, string>();
      for (const c of sc.chapters ?? []) chapterFolder.set(c.segment_id, c.hook || c.title);
      for (const m of sc.photo_moments ?? []) {
        moments.push({ ...m, media_id: mediaId, folder: m.segment_id ? chapterFolder.get(m.segment_id) ?? null : null });
      }
    } catch { /* sidecar not published yet */ }
  }));

  return { vault: (v ?? null) as Vault | null, photos, urls, linked: (seg ?? []) as Segment[], moments };
}

const decadeOf = (year: number | null) => (year == null ? null : `${Math.floor(year / 10) * 10}s`);

function GalleryPage() {
  return <RequireSession><GalleryPageInner /></RequireSession>;
}

function GalleryPageInner() {
  const { vaultId } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["photos", vaultId], queryFn: () => loadPhotos(vaultId),
    staleTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const [collection, setCollection] = useState<string>("all");
  const [notes, setNotes] = useState<Photo | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const queryClient = useQueryClient();

  if (isLoading || !data) return <ArchiveShell vaultId={vaultId}><LoadingBlock label="Opening the folio…" /></ArchiveShell>;
  const { vault, photos, urls, moments } = data;

  function momentFor(photoId: string) { return moments.find((m) => m.photo_id === photoId) ?? null; }
  /** A photo's folder: the story it belongs to, else its decade, else undated. */
  function folderOf(p: Photo) {
    return momentFor(p.id)?.folder ?? decadeOf(p.taken_year) ?? "Not yet catalogued";
  }

  const folders = [...new Set(photos.map(folderOf))];
  const collections = [
    { key: "all", label: "Everything", count: photos.length },
    ...folders.map((f) => ({ key: f, label: f, count: photos.filter((p) => folderOf(p) === f).length })),
  ];
  const shown = photos.filter((p) => collection === "all" || folderOf(p) === collection);

  return (
    <ArchiveShell vaultId={vaultId}>
      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <BackLink label={vault?.name ?? "the vault"} link={{ to: "/vault/$vaultId", params: { vaultId } }} />
        <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold text-navy sm:text-5xl">
          {photos.length ? `${vault?.subject_name ?? "Her"}’s gallery` : "Bring her photographs in"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          Lay scans, prints, or slides into the archive. Each piece is catalogued and bound to the moment in a recording where it is spoken about.
        </p>

        <div className="mt-6 flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-2">
            {collections.map((c) => (
              <Button key={c.key} size="sm" variant={collection === c.key ? "default" : "outline"}
                      className="rounded-full" onClick={() => setCollection(c.key)}>
                {c.key !== "all" && <FolderOpen />}{c.label} ({c.count})
              </Button>
            ))}
          </div>
          <Button size="sm" className="shrink-0 rounded-full bg-gold text-navy hover:bg-gold-strong lg:ml-auto"
                  onClick={() => setUploadOpen(true)}>
            <Upload /> Upload media
          </Button>
        </div>

        <UploadMediaDialog vaultId={vaultId} subjectName={vault?.subject_name ?? "this vault"}
                           folderHint={collection === "all" ? null : collection}
                           open={uploadOpen} onOpenChange={setUploadOpen}
                           onSaved={async () => {
                             setUploadOpen(false);
                             await queryClient.invalidateQueries({ queryKey: ["photos", vaultId] });
                             await queryClient.invalidateQueries({ queryKey: ["vault", vaultId] });
                             await queryClient.invalidateQueries({ queryKey: ["vaults"] });
                           }} />

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p, i) => {
            const moment = momentFor(p.id);
            return (
              <article key={p.id} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-paper">
                <div className="overflow-hidden rounded-lg bg-secondary">
                  {urls[p.storage_path]
                    ? <img src={urls[p.storage_path]} alt={p.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    : <Still src={null} crop={(i % 6) + 1} alt={p.title} />}
                </div>
                <h2 className="mt-4 text-sm font-bold text-navy">{p.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.taken_year ?? "Undated"} · <span className="font-semibold text-gold-strong">{folderOf(p)}</span>
                </p>
                {moment?.blurb && <p className="mt-2 line-clamp-2 text-xs italic leading-5 text-muted-foreground">“{moment.blurb}”</p>}
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="ghost" onClick={() => setNotes(p)}><StickyNote /> View notes</Button>
                  {moment ? (
                    <Button asChild size="sm" variant="ghost" className="text-primary">
                      <Link to="/screening/$mediaId" params={{ mediaId: moment.media_id }} search={moment.segment_id ? { seg: moment.segment_id } : {}}>
                        <Mic /> Oral story · {formatTime(moment.seconds)}
                      </Link>
                    </Button>
                  ) : <span className="self-center text-[0.62rem] uppercase tracking-[0.13em] text-muted-foreground">Not yet spoken about</span>}
                </div>
              </article>
            );
          })}

          <button type="button" onClick={() => setUploadOpen(true)}
                  className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border text-center transition hover:border-gold hover:bg-card">
            <div className="px-6">
              <span className="mx-auto grid size-12 place-items-center rounded-full border border-border text-primary"><Upload /></span>
              <h2 className="mt-4 font-display text-xl font-bold text-primary">Upload media</h2>
              <p className="mx-auto mt-2 max-w-56 text-xs leading-5 text-muted-foreground">
                Add a photograph to the folio, or a video that becomes a recording in this vault.
                Folders follow the story a photograph belongs to.
              </p>
            </div>
          </button>
        </div>

        <Dialog open={!!notes} onOpenChange={(o) => !o && setNotes(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl text-navy">{notes?.title}</DialogTitle>
              <DialogDescription>{notes?.taken_year ? `Family archive · ${notes.taken_year}` : "Family archive"}</DialogDescription>
            </DialogHeader>
            {notes && urls[notes.storage_path] && (
              <img src={urls[notes.storage_path]} alt={notes.title} className="w-full rounded-lg" />
            )}
            <p className="text-sm leading-6 text-foreground">{notes?.caption ?? "No notes recorded for this photograph yet."}</p>
            {notes && momentFor(notes.id) && (
              <Button asChild className="bg-gold text-navy hover:bg-gold-strong">
                <Link to="/screening/$mediaId" params={{ mediaId: momentFor(notes.id)!.media_id }}
                      search={momentFor(notes.id)!.segment_id ? { seg: momentFor(notes.id)!.segment_id! } : {}}>
                  <Mic /> Hear her speak about this · {formatTime(momentFor(notes.id)!.seconds)}
                </Link>
              </Button>
            )}
          </DialogContent>
        </Dialog>
      </section>
    </ArchiveShell>
  );
}
