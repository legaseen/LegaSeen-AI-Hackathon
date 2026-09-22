import { useQuery } from "@tanstack/react-query";

import { supabase } from "./supabase";

const VIDEO_BUCKET = "interview-videos";   // same bucket as media-upload; not imported to avoid a cycle

/**
 * Pipeline progress for a recording, read from `{vault}/{media}.status.json`
 * beside the video. scripts/worker.py writes it; nothing else does. A missing
 * file on a recording that already has a transcript sidecar means "ready"; a
 * missing file on one that doesn't means it was uploaded before the worker
 * existed.
 */
export type ProcessingState = "queued" | "transcribing" | "chaptering" | "translating" | "photos" | "publishing" | "done" | "failed";
export type ProcessingStatus = {
  state: ProcessingState; message?: string; error?: string; updated_at: string; chapters?: number;
};

export const STATE_LABEL: Record<ProcessingState, string> = {
  queued: "Queued for the archive", transcribing: "Transcribing", chaptering: "Finding the chapters", translating: "Translating for the family",
  photos: "Matching photographs", publishing: "Publishing", done: "Ready", failed: "Needs attention",
};

export const isBusy = (s: ProcessingStatus | null | undefined) => !!s && s.state !== "done" && s.state !== "failed";

const statusPath = (vaultId: string, mediaId: string) => `${vaultId}/${mediaId}.status.json`;

/** Called the moment a recording is saved, so the card shows "Queued" before the worker picks it up. */
export async function markQueued(vaultId: string, mediaId: string): Promise<void> {
  const body: ProcessingStatus = { state: "queued", message: "Queued for the archive", updated_at: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
  const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(statusPath(vaultId, mediaId), blob, { contentType: "application/json", upsert: true });
  if (error) console.warn("could not mark recording as queued:", error.message);
}

export async function fetchStatus(vaultId: string, mediaId: string): Promise<ProcessingStatus | null> {
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).download(statusPath(vaultId, mediaId));
  if (error || !data) return null;
  try { return JSON.parse(await data.text()) as ProcessingStatus; } catch { return null; }
}

export async function fetchStatuses(vaultId: string, mediaIds: string[]): Promise<Record<string, ProcessingStatus | null>> {
  const entries = await Promise.all(mediaIds.map(async (id) => [id, await fetchStatus(vaultId, id)] as const));
  return Object.fromEntries(entries);
}

/** Live statuses for a set of recordings; polls every 4s while any is still being processed. */
export function useProcessing(vaultId: string, mediaIds: string[]) {
  const key = mediaIds.join(",");
  return useQuery({
    queryKey: ["processing", vaultId, key],
    queryFn: () => fetchStatuses(vaultId, mediaIds),
    enabled: mediaIds.length > 0,
    refetchInterval: (q) => {
      const d = q.state.data as Record<string, ProcessingStatus | null> | undefined;
      return d && Object.values(d).some(isBusy) ? 4000 : false;
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}
