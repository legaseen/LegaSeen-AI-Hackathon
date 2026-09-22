import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteRecording } from "@/lib/media-delete";

/** A confirm-then-delete button for one recording. */
export function DeleteRecordingButton({ media, title, onDeleted, size = "sm", variant = "ghost", label = "Delete recording" }: {
  media: { id: string; vault_id: string; storage_path?: string | null };
  title: string; onDeleted: () => void | Promise<void>;
  size?: "sm" | "default"; variant?: "ghost" | "outline"; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm(e: React.MouseEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await deleteRecording(media);
      await onDeleted();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant} className="text-muted-foreground hover:text-destructive"><Trash2 /> {label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-navy">Delete “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The video, its transcript, chapters and captions are removed from the vault. Photographs stay. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy ? <><Loader2 className="animate-spin" /> Deleting…</> : "Delete recording"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
