/**
 * Play exactly one story segment out of a longer recording.
 *
 * Seeks to start_seconds (with a short lead-in so the first word isn't clipped),
 * plays, and pauses at end_seconds. Calling it again cancels the previous
 * segment cleanly — no stacked listeners, no runaway playback.
 */
export type PlayableSegment = { start_seconds: number; end_seconds: number };

const LEAD_IN_SECONDS = 0.5;

/** One teardown per video element, so repeat calls can't stack listeners. */
const activeTeardowns = new WeakMap<HTMLVideoElement, () => void>();

export function playSegment(
  video: HTMLVideoElement,
  segment: PlayableSegment,
  onEnd?: () => void,
): () => void {
  activeTeardowns.get(video)?.();

  const start = Math.max(0, segment.start_seconds - LEAD_IN_SECONDS);
  const end = segment.end_seconds;
  let done = false;

  const stop = () => {
    if (done) return;
    done = true;
    video.pause();
    teardown();
    onEnd?.();
  };

  const onTimeUpdate = () => { if (video.currentTime >= end) stop(); };
  const onEnded = () => stop();

  function teardown() {
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("ended", onEnded);
    activeTeardowns.delete(video);
  }

  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("ended", onEnded);
  activeTeardowns.set(video, teardown);

  const begin = () => {
    video.currentTime = start;
    void video.play().catch(() => { /* autoplay blocked; user can press play */ });
  };

  // Seeking before metadata loads is ignored by the browser.
  if (video.readyState >= 1) begin();
  else video.addEventListener("loadedmetadata", begin, { once: true });

  return () => { done = true; video.pause(); teardown(); };
}

export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
