import { VIDEO_BUCKET } from "./media-upload";
import { supabase } from "./supabase";

/**
 * Remove a recording and everything the archive made from it: its chapters,
 * every sidecar (transcript, captions, poster, thumbnails, session plan,
 * status) and the video itself, then the row. Photographs are their own
 * assets and are left alone. RLS decides whether the caller may.
 */
export async function deleteRecording(media: { id: string; vault_id: string; storage_path?: string | null }): Promise<void> {
  let storagePath = media.storage_path ?? "";
  if (!storagePath) {
    const { data } = await supabase.from("media_assets").select("storage_path").eq("id", media.id).maybeSingle();
    storagePath = data?.storage_path ?? "";
  }
  const segs = await supabase.from("story_segments").delete().eq("source_media_id", media.id);
  if (segs.error) throw new Error(`Could not remove the chapters: ${segs.error.message}`);

  // Every object beside the video whose name carries the recording's id.
  const { data: objects, error: listErr } = await supabase.storage.from(VIDEO_BUCKET).list(media.vault_id, { limit: 1000, search: media.id });
  if (listErr) throw new Error(`Could not list the vault: ${listErr.message}`);
  const video = storagePath.startsWith(`${VIDEO_BUCKET}/`) ? storagePath.slice(VIDEO_BUCKET.length + 1) : storagePath;
  const paths = Array.from(new Set([...(objects ?? []).map((o) => `${media.vault_id}/${o.name}`), video].filter(Boolean)));
  if (paths.length) {
    const rm = await supabase.storage.from(VIDEO_BUCKET).remove(paths);
    if (rm.error) throw new Error(`Could not remove the files: ${rm.error.message}`);
  }

  const row = await supabase.from("media_assets").delete().eq("id", media.id).select("id");
  if (row.error) throw new Error(`Could not remove the recording: ${row.error.message}`);
  if (!row.data?.length) throw new Error("The recording could not be removed — you may not have permission.");
}
