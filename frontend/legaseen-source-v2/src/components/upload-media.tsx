import { useEffect, useState } from "react";
import { Check, Image as ImageIcon, RotateCcw, Upload, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SOFT_LIMIT_BYTES, clock, durationOf, mb, uploadPhoto, uploadRecording } from "@/lib/media-upload";

type Kind = "photo" | "video";

/**
 * One dialog for both kinds of media. Photographs are catalogued into
 * archival-photos; videos become recordings in interview-videos and are
 * indexed by the archive.
 */
export function UploadMediaDialog({ vaultId, subjectName, folderHint, open, onOpenChange, onSaved }: {
  vaultId: string; subjectName: string; folderHint?: string | null;
  open: boolean; onOpenChange: (open: boolean) => void; onSaved: (kind: Kind, id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [year, setYear] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const kind: Kind | null = file ? (file.type.startsWith("video") ? "video" : "photo") : null;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => { if (!open) reset(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl(null); setTitle(""); setCaption(""); setYear(""); setDuration(null); setErr(null); setBusy(false);
  }

  async function choose(f: File | null) {
    setErr(null); setDuration(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f); setPreviewUrl(f ? URL.createObjectURL(f) : null);
    if (!f) return;
    setTitle((t) => t || f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    if (f.type.startsWith("video")) setDuration(await durationOf(f));
    else if (f.lastModified) setYear((y) => y || String(new Date(f.lastModified).getFullYear()));
  }

  async function save() {
    if (!file || !kind) return;
    const name = title.trim() || file.name;
    setBusy(true); setErr(null);
    try {
      if (kind === "video") {
        onSaved("video", await uploadRecording(vaultId, file, file.type || "video/mp4", name, duration));
      } else {
        const parsed = Number.parseInt(year, 10);
        const takenYear = Number.isFinite(parsed) && parsed >= 1800 && parsed <= new Date().getFullYear() + 1 ? parsed : null;
        if (year.trim() && takenYear === null) throw new Error("That year doesn't look right — use a four-digit year like 1948.");
        onSaved("photo", await uploadPhoto(vaultId, file, { title: name, caption: caption.trim() || null, takenYear }));
      }
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const field = "mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-gold";
  const label = "block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">Add to {subjectName}&apos;s archive</DialogTitle>
          <DialogDescription>
            Photographs are catalogued into the folio{folderHint ? ` (this will join ${folderHint} if it matches)` : ""}.
            Videos become recordings and are indexed into chapters and a transcript.
          </DialogDescription>
        </DialogHeader>

        {err && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

        <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-background text-center hover:border-gold">
          {previewUrl && kind === "photo" && <img src={previewUrl} alt="" className="max-h-64 w-full object-contain" />}
          {previewUrl && kind === "video" && <video src={previewUrl} controls playsInline className="max-h-64 w-full bg-navy" />}
          {!previewUrl && (
            <>
              <span className="flex gap-3 text-primary"><ImageIcon className="size-7" /><Video className="size-7" /></span>
              <span className="mt-3 text-sm font-semibold text-navy">Choose a photograph or a video</span>
              <span className="mt-1 text-xs text-muted-foreground">JPG, PNG, HEIC · MP4, MOV, WebM · up to about 50 MB</span>
            </>
          )}
          <input type="file" accept="image/*,video/*" className="sr-only" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </label>

        {file && (
          <>
            <div className="flex items-center gap-2 text-[0.62rem] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              {kind === "video" ? <Video className="size-3.5" /> : <ImageIcon className="size-3.5" />}
              {kind === "video" ? "Recording" : "Photograph"} · {mb(file.size)}{duration != null ? ` · ${clock(duration)}` : ""}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => choose(null)} disabled={busy}><RotateCcw /> Change</Button>
            </div>

            <label className={label}>Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={field}
                     placeholder={kind === "video" ? "e.g. Second sitting, the kitchen table" : "e.g. Cutting the cake, June 1949"} />
            </label>

            {kind === "photo" && (
              <>
                <label className={label}>Year taken <span className="font-normal normal-case tracking-normal">(sets the folder)</span>
                  <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="e.g. 1949" className={field} />
                </label>
                <label className={label}>Notes <span className="font-normal normal-case tracking-normal">(optional)</span>
                  <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2}
                            placeholder="Who is in it, where it was taken, what was happening…"
                            className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold" />
                </label>
              </>
            )}

            {file.size > SOFT_LIMIT_BYTES && (
              <p className="text-xs text-destructive">This file is over 50 MB, which the archive&apos;s storage may refuse.</p>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !file} className="bg-gold text-navy hover:bg-gold-strong">
            {busy ? "Adding…" : <><Check /> Add to archive</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { Upload as UploadIcon };
