# AI integration — for the frontend

How to call search and play the clip it points at. Working reference
implementation lives in `web/` (`src/lib/supabase.ts`, `src/lib/playSegment.ts`).

## Calling search

Deployed as a Supabase edge function at `/functions/v1/search`.

```ts
const { data, error } = await supabase.functions.invoke("search", {
  body: {
    vault_id: vault.id,          // required
    media_id: interview.id,      // optional — restrict to one interview
    emotion: "GriefNavigation",  // optional — one of the feeling pills
    query: "i feel like a fraud", // optional — free text
    exclude_ids: shownIds,       // optional — for "show me a different story"
  },
});
```

The product model is three levels: **Archive** (one vault per person) →
**Vault** (that person's interviews, one card each) → **Interview** (its
chapters and transcript). On the vault screen call search **without**
`media_id`: it looks across every interview and the returned
`segment.source_media_id` tells you which interview to open, at
`start_seconds`. Inside an interview pass `media_id` so results stay in it.

Pass `emotion` **or** `query`. `emotion` is a tag match — no LLM, instant, free.
`query` runs a crisis check, then the model picks one story.

`supabase.functions.invoke` attaches the signed-in user's JWT automatically.
The function uses it to read `story_segments`, so **RLS decides what the viewer
sees** — a viewer only ever gets stories from vaults they belong to.

## Three response shapes

Check `crisis` first, always.

```ts
// 1. CRISIS — never render a clip alongside this
{ crisis: true,
  message: "It sounds like you're going through something really heavy…",
  resources: [ { name: "Lifeline", phone: "13 11 14", detail: "24/7 crisis support" },
               { name: "Kids Helpline", phone: "1800 55 1800", detail: "24/7, for ages 5-25" } ],
  segment: null }

// 2. MATCH
{ found: true,
  segment: { id, vault_id, source_media_id, title, transcript, summary,
             start_seconds, end_seconds, topics, emotions, wisdom_tags, era },
  reason: "This story gently shows you that…",   // second person, show it verbatim
  cached?: true }

// 3. NOTHING SUITABLE
{ found: false, segment: null, message: "No story tagged RomanticHeartbreak yet." }
```

```ts
if ("crisis" in result) { showCrisis(result); clearPlayer(); return; }
if (!result.found)      { showEmpty(result.message); return; }
showStory(result.segment, result.reason);
```

**On crisis, clear any player already on screen.** Do not leave a video sitting
under the crisis message.

## Getting a playable URL

`interview-videos` is a private bucket, so you need a signed URL:

```ts
const path = media.storage_path.replace(/^interview-videos\//, "");
const { data } = await supabase.storage
  .from("interview-videos").createSignedUrl(path, 3600);
// data.signedUrl -> <video src={...}>
```

## Playing one segment

`start_seconds` and `end_seconds` are integers derived from the actual Scribe
word timings — `floor(first word start)` and `ceil(last word end)`.

```ts
const LEAD_IN_SECONDS = 0.5;
const activeTeardowns = new WeakMap<HTMLVideoElement, () => void>();

export function playSegment(
  video: HTMLVideoElement,
  segment: { start_seconds: number; end_seconds: number },
  onEnd?: () => void,
): () => void {
  activeTeardowns.get(video)?.();        // cancel the previous segment

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
    void video.play().catch(() => { /* autoplay blocked — user presses play */ });
  };
  if (video.readyState >= 1) begin();                                  // metadata ready
  else video.addEventListener("loadedmetadata", begin, { once: true }); // seek would be ignored

  return () => { done = true; video.pause(); teardown(); };            // manual cancel
}
```

Three things this handles that a naive version does not:

1. **Previous listener is removed** before a new segment starts. Without the
   `WeakMap`, playing three segments leaves three `timeupdate` listeners
   attached and the first one to fire pauses the wrong clip.
2. **Seeking waits for metadata.** Setting `currentTime` before
   `readyState >= 1` is silently ignored, so the clip plays from 0:00.
3. **`ended` is handled**, not just `timeupdate`. The last segment's
   `end_seconds` can exceed the media duration by up to a second, because
   `end_seconds` ceils — without this it never pauses.

Verified: a segment of `3s-22s` seeks to 2.5s and pauses at **22.07s**.

## Tags

`scripts/taxonomy.json` in the pipeline repo is the only source of truth —
the database does not constrain these values. Render pills from the same lists.

Values are stored PascalCase with no `#`; add the hash in the UI.

`emotions` is **viewer-framed** — the state the person searching is in, not what
the subject felt. That is what "START WITH A FEELING" maps onto.

**Do not render a pill for an emotion no segment carries.** `segment.py` prints
the zero-count list on every run. In `web/` these render disabled and dashed
rather than being hidden, so the set of feelings stays stable between vaults.

## Vault screen: one card per interview

Interviews are `media_assets` rows with `media_type` in `('video','audio')`.
Per card you need its chapters (`story_segments where source_media_id = id`)
for the count and tags, and a poster frame published by the pipeline at
`interview-videos/{vault_id}/{media_id}-poster.jpg` — sign it directly, no need
to fetch the sidecar just for the image. `media_assets.duration_seconds` is set
by the pipeline; `created_at` is the upload time (there is no recording-date
column — ask the schema owner for `recorded_at` if you need the real date).

## Interview view: synced transcript, chapters, photo moments

Everything the screening screen needs beyond `story_segments` is in one JSON
sidecar in storage. Fetch it with a signed URL, same as the video:

```ts
const { data } = await supabase.storage
  .from("interview-videos")
  .createSignedUrl(`${vault_id}/${media_id}.transcript.json`, 600);
const sidecar = await (await fetch(data.signedUrl)).json();
```

```ts
type Sidecar = {
  media_id: string; vault_id: string; title: string; duration: number;
  speakers: Record<string, { label: string; role: "subject" | "interviewer" }>;
  utterances: { n: number; speaker: string; start: number; end: number; text: string;
                words: { t: string; s: number; e: number }[] }[];
  chapters: { segment_id: string; title: string; summary: string; hook: string | null;
              start_seconds: number; end_seconds: number; utterances: [number, number];
              quote: { utterance: number; text: string; start: number; end: number } | null;
              thumbnail_path: string | null; related_photo_id: string | null;
              topics: string[]; emotions: string[]; wisdom_tags: string[]; era: string[] }[];
  photo_moments: { photo_id: string; title: string; caption: string; taken_year: number;
                   storage_path: string; utterance: number; seconds: number;
                   segment_id: string | null; blurb: string }[];
  captions_path: string;   // WebVTT, for <track kind="captions">
  poster_path: string | null; // frame for the interview card
};
```

Every `start`/`end`/`seconds` is a Scribe timing. `text` is verbatim Scribe text.
Only `hook`, `summary`, `title`, tags and `blurb` are model-written.

### Following the video

Render one block per utterance. Highlight the one being spoken and keep it in
view; click a block to seek. Find the current block by binary search on
`start` — a linear scan is fine too, transcripts are small:

```ts
function currentUtteranceIndex(u: Utterance[], t: number) {
  let lo = 0, hi = u.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (u[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

video.addEventListener("timeupdate", () => setIdx(currentUtteranceIndex(utts, video.currentTime)));
video.addEventListener("seeked",     () => setIdx(currentUtteranceIndex(utts, video.currentTime)));
```

Attach these to the element itself (callback ref), not a `RefObject` — the
player usually mounts after the data loads, and a ref-based effect won't re-arm.

Scroll the **panel**, not the page: `panel.scrollTo({ top: el.offsetTop - panel.offsetTop - panel.clientHeight/2 })`.
`scrollIntoView` will yank the whole page when the panel is partially off-screen.

`chapters[i].quote.utterance` tells you which block to style as the pull-quote
("Archival highlight") while that chapter is active. `speakers[u.speaker].role`
lets you dim the interviewer's lines.

Thumbnails and photos are private too: `createSignedUrls([...paths], 3600)`
does them all in one call. Photo `storage_path` is in `archival-photos`;
thumbnails are in `interview-videos`.

`photo_moments[i].seconds` → "jump to reel moment": set `currentTime` and play.
That's a seek, not a `playSegment` — it shouldn't auto-pause.
