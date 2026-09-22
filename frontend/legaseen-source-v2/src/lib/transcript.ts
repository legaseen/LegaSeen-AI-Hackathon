/**
 * The transcript sidecar: word-timed utterances, chapters and photo moments,
 * published by scripts/publish.py to
 *   interview-videos/{vault_id}/{media_id}.transcript.json
 * Every timestamp in here comes from Scribe. The frontend never derives times.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Word = { t: string; s: number | null; e: number | null };
export type Utterance = {
  n: number; speaker: string; start: number; end: number; text: string; words: Word[];
};
export type Quote = { utterance: number; text: string; start: number; end: number };
export type Chapter = {
  segment_id: string; title: string; summary: string | null; hook: string | null;
  start_seconds: number; end_seconds: number; utterances: [number, number] | null;
  quote: Quote | null; thumbnail_path: string | null;
  topics: string[]; emotions: string[]; wisdom_tags: string[]; era: string[];
  related_photo_id: string | null;
};
export type PhotoMoment = {
  photo_id: string; title: string; caption: string | null; taken_year: number | null;
  storage_path: string; utterance: number; seconds: number; segment_id: string | null; blurb: string;
};
export type Sidecar = {
  version: number; media_id: string; vault_id: string; title: string;
  duration: number | null; language: string | null;
  speakers: Record<string, { label: string; role: "subject" | "interviewer" | string }>;
  utterances: Utterance[]; chapters: Chapter[]; photo_moments: PhotoMoment[];
  captions_path: string; generated_at: string;
  /** English captions and per-utterance translations, present when the recording isn't in English. */
  captions_en_path?: string | null;
  translations?: Record<string, Record<string, string>>;
};

const strip = (bucket: string, p: string) => p.replace(new RegExp(`^${bucket}/`), "");

export async function signedUrl(bucket: string, path: string, ttl = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(strip(bucket, path), ttl);
  return error ? null : data.signedUrl;
}

/** Many paths in one round trip. Returns path -> url (missing on failure). */
export async function signedUrls(bucket: string, paths: string[], ttl = 3600): Promise<Record<string, string>> {
  const clean = paths.map((p) => strip(bucket, p));
  if (clean.length === 0) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(clean, ttl);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.signedUrl && row.path) out[row.path] = row.signedUrl;
  return out;
}

export async function fetchSidecar(vaultId: string, mediaId: string): Promise<Sidecar | null> {
  // null means "not published yet" and is cached for a long time, so only a
  // genuinely missing object may produce it. Anything else — an auth hiccup
  // during token refresh, a network blip — throws, and the query retries.
  const path = `${vaultId}/${mediaId}.transcript.json`;
  const { data, error } = await supabase.storage.from("interview-videos").createSignedUrl(path, 600);
  if (error) {
    if (/not found|does not exist/i.test(error.message)) return null;
    throw new Error(`could not reach the transcript: ${error.message}`);
  }
  const res = await fetch(data.signedUrl);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`transcript fetch failed: ${res.status}`);
  return (await res.json()) as Sidecar;
}

/** Index of the utterance being spoken at time t: the last one that has started. */
export function currentUtteranceIndex(u: Utterance[], t: number): number {
  let lo = 0, hi = u.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = u[mid];
    if (item && item.start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Follow a <video> element through the transcript. Takes the element itself
 * (from a callback ref) rather than a RefObject so it re-arms when the player
 * mounts after the data loads.
 */
export function useSyncedTranscript(video: HTMLVideoElement | null, utterances: Utterance[]): number {
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!video || utterances.length === 0) { setIndex(-1); return; }
    const update = () => setIndex(currentUtteranceIndex(utterances, video.currentTime));
    video.addEventListener("timeupdate", update);
    video.addEventListener("seeked", update);
    update();
    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("seeked", update);
    };
  }, [video, utterances]);
  return index;
}
