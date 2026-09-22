import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env["VITE_SUPABASE_URL"],
  import.meta.env["VITE_SUPABASE_ANON_KEY"],
  { auth: { persistSession: true, autoRefreshToken: true } },
);

export type Segment = {
  id: string;
  vault_id: string;
  source_media_id: string;
  title: string;
  transcript: string;
  summary: string | null;
  start_seconds: number;
  end_seconds: number;
  topics: string[];
  emotions: string[];
  wisdom_tags: string[];
  era: string[];
};

export type Vault = {
  id: string; name: string; subject_name: string; description: string | null;
};

export type MediaAsset = {
  id: string; vault_id: string; title: string; media_type: string;
  storage_path: string; duration_seconds: number | null; created_at: string;
};

/** `transcript` is what Scribe heard when the question was spoken; `audio_b64` the spoken answer when asked for. */
type Voiced = { transcript?: string; audio_b64?: string | null };
export type SearchResult =
  | ({ crisis: true; message: string; resources: { name: string; phone: string; detail: string }[]; segment: null } & Voiced)
  | ({ found: true; segment: Segment; reason: string; cached?: boolean } & Voiced)
  | ({ found: false; segment: null; message: string } & Voiced);

/** Call the search edge function as the signed-in viewer. */
export async function search(body: {
  vault_id: string; media_id?: string; emotion?: string; query?: string; exclude_ids?: string[];
  /** A spoken question; transcribed server-side and used as the query. */
  audio?: Blob | null;
  /** Ask for the answer as speech too. */
  speak?: boolean;
}): Promise<SearchResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not signed in");

  const { audio, ...rest } = body;
  const payload: Record<string, unknown> = { ...rest };
  if (audio && audio.size > 0) {
    payload["audio"] = await blobToBase64(audio);
    payload["mime"] = audio.type || "audio/webm";
  }

  const res = await fetch(import.meta.env["VITE_SEARCH_URL"], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env["VITE_SUPABASE_ANON_KEY"],
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Private bucket, so playback needs a short-lived signed URL. */
export async function signedVideoUrl(storagePath: string): Promise<string> {
  const path = storagePath.replace(/^interview-videos\//, "");
  const { data, error } = await supabase.storage
    .from("interview-videos").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
