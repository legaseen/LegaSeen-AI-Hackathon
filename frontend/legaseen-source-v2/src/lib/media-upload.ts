import { supabase } from "./supabase";
import { markQueued } from "./processing";

export const VIDEO_BUCKET = "interview-videos";
export const PHOTO_BUCKET = "archival-photos";
/** Supabase's default per-object limit. */
export const SOFT_LIMIT_BYTES = 50 * 1024 * 1024;

export const extFor = (mime: string, fallback = "webm") =>
  mime.includes("mp4") ? "mp4" : mime.includes("quicktime") ? "mov" : mime.includes("webm") ? "webm"
  : mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : mime.includes("heic") ? "heic" : fallback;

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "item";

export const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("You're not signed in.");
  return uid;
}

/** Grab a frame so a fresh recording never shows a placeholder. */
export function posterFrom(src: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(src);
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const done = (b: Blob | null) => { URL.revokeObjectURL(url); resolve(b); };
    const timer = setTimeout(() => done(null), 8000);
    v.onerror = () => { clearTimeout(timer); done(null); };
    v.onloadedmetadata = () => { v.currentTime = Number.isFinite(v.duration) && v.duration > 2 ? Math.min(2, v.duration / 4) : 1; };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      clearTimeout(timer);
      c.toBlob((b) => done(b), "image/jpeg", 0.85);
    };
  });
}

export function durationOf(src: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(src);
    const v = document.createElement("video");
    v.preload = "metadata"; v.src = url;
    const finish = (d: number | null) => { URL.revokeObjectURL(url); resolve(d); };
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
    setTimeout(() => finish(null), 5000);
  });
}

/** Storage + media_assets as the signed-in owner/editor, through RLS. */
export async function uploadRecording(
  vaultId: string, blob: Blob, mime: string, title: string, durationSeconds: number | null,
): Promise<string> {
  const uid = await currentUserId();
  const path = `${vaultId}/${slug(title)}-${Date.now()}.${extFor(mime)}`;   // exactly {vault_id}/{filename}
  const up = await supabase.storage.from(VIDEO_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  const ins = await supabase.from("media_assets")
    .insert({ vault_id: vaultId, uploaded_by: uid, title, media_type: "video", storage_path: path, mime_type: mime, duration_seconds: durationSeconds })
    .select("id").single();
  if (ins.error) throw new Error(`Could not register the recording: ${ins.error.message}`);
  const poster = await posterFrom(blob);
  if (poster) await supabase.storage.from(VIDEO_BUCKET).upload(`${vaultId}/${ins.data.id}-poster.jpg`, poster, { contentType: "image/jpeg", upsert: true });
  // The worker picks it up from here; this just makes the card say so at once.
  await markQueued(vaultId, ins.data.id);
  return ins.data.id;
}

export async function uploadPhoto(
  vaultId: string, file: File, meta: { title: string; caption: string | null; takenYear: number | null },
): Promise<string> {
  const uid = await currentUserId();
  const mime = file.type || "image/jpeg";
  const path = `${vaultId}/${slug(meta.title)}-${Date.now()}.${extFor(mime, "jpg")}`;
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  const ins = await supabase.from("media_assets")
    .insert({ vault_id: vaultId, uploaded_by: uid, title: meta.title, media_type: "photo", storage_path: path, mime_type: mime, caption: meta.caption, taken_year: meta.takenYear })
    .select("id").single();
  if (ins.error) throw new Error(`Could not catalogue the photograph: ${ins.error.message}`);
  return ins.data.id;
}
