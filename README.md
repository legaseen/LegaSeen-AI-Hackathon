# LegaSeen — The Legacy Vault

An elder's life story, recorded once and findable forever.

A two-hour recording is a locked box: nobody rewatches it, and nobody can find
the part they need. LegaSeen turns it into a searchable archive — a grandchild
can ask *"how did she cope when Grandad died"* and get ninety seconds of her
voice, in three seconds.

What's here:

- **The archive pipeline** — Scribe v2 transcription with word-level
  timestamps, story segmentation and emotional tagging, photo matching, and a
  worker that runs it all automatically the moment a recording is saved.
- **Timestamped search** — ask in plain words or by voice, in any language, and
  land on the exact chapter.
- **An AI interviewer** — for families who can't afford a film crew: it sits
  with the elder, asks one question at a time following a ten-part life-story
  arc drawn from oral-history practice, and follows what she actually says.
- **The app** — `frontend/legaseen-source-v2`, the vault, screening room and
  gallery.
- **Guardrails and evaluations** — a crisis filter in every language, a
  question guard, and 134 checks that run before anything ships.

Two rules hold throughout: transcript text and timestamps come only from
Scribe, never from a language model; and nothing here creates tables, alters
schema, or writes migrations — the database schema is owned elsewhere.

## Security model

- The pipeline signs in as a **vault editor** using the **anon key**. Every read
  and write goes through RLS and the existing validation triggers.
- The **service-role key is never used and never requested.**
- Secrets live in `.env` (gitignored) and, for edge functions, in Supabase
  secrets. They never appear in frontend code.
- Transcript text and all timestamps come from **Scribe**. The LLM only chooses
  story boundaries, titles, summaries and tags — it never produces transcript
  text or times.

## Setup

```bash
brew install ffmpeg
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python elevenlabs supabase python-dotenv openai
cp .env.example .env   # then fill in the blanks
```

`.env` needs: `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `PIPELINE_EDITOR_EMAIL`,
`PIPELINE_EDITOR_PASSWORD`. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are
pre-filled from the Lovable project.

The editor account must either **own** the target vault or have a
`vault_members` row with `role='editor'`. Only a vault owner can grant that.

## Phase 1 — transcription

```bash
# local file
python scripts/transcribe.py interviews/nan.mp4

# straight from Supabase storage
python scripts/transcribe.py --media-id 3f2b8c41-....
```

With `--media-id` it signs in as the editor, reads the `media_assets` row,
mints a 10-minute signed URL for the object in `interview-videos`, downloads it,
and extracts mono 16 kHz audio with ffmpeg.

Scribe is called with `diarize=True`, `timestamps_granularity="word"`,
`tag_audio_events=True`, and any keyterms from `config/keyterms.json`.

Writes `data/<media_id or filename>/transcript.json` — the full Scribe payload
including every word with `start`, `end`, `type` and `speaker_id`. Phase 2 reads
this file and never re-derives timings from anything else.

Flags: `--language en`, `--num-speakers 2`, `--keep-audio`, `--keyterms PATH`.

## Layout

```
scripts/_common.py      env loading, editor sign-in, storage path handling
scripts/transcribe.py   Phase 1
config/keyterms.json    Scribe biasing hints
data/<key>/             transcript.json (gitignored)
```

## Phase 2 — segmentation and tagging

```bash
# 1. inspect the numbered utterances, no API call, nothing written
python scripts/segment.py test_interview --dry-run

# 2. segment + tag, save data/<key>/segments.json, database untouched
python scripts/segment.py test_interview --no-write

# 3. write to Supabase (replaces any existing segments for that media)
python scripts/segment.py --media-id <uuid>

# re-run the deterministic half without paying for another LLM call
python scripts/segment.py test_interview --replay --no-write
```

Scribe words are grouped into speaker-attributed sentences (abbreviations like
"Mrs." do not split). OpenAI sees only numbered utterances and returns boundaries
by number, plus title, summary and tags — never text or times.

Everything else is rebuilt from Scribe: `start_seconds = floor(first word start)`,
`end_seconds = ceil(last word end)`, and `transcript` is the exact token slice.
Tags not present in `scripts/taxonomy.json` are dropped.

Every row is validated against the database contract before any write. Adjacent
segments may overlap by up to 1s — an artifact of floor/ceil — which is allowed;
larger overlaps are rejected. `end_seconds` can exceed the media duration by up
to 1s for the final segment, which is harmless for playback.

Default mode signs in as the editor, deletes existing `story_segments` for that
`source_media_id`, inserts the new rows, and prints a table plus a per-emotion
count. Emotions with zero segments are listed explicitly so the UI does not
render them as pills.

### Tag vocabulary

`scripts/taxonomy.json` is the **only** source of truth for tag values — the
database does not constrain them (no CHECK, no enum). The UI must render pills
from these same lists.

## Phase 3 — search edge function

`supabase/functions/search/index.ts`

```
POST /functions/v1/search
{ "vault_id": "uuid", "emotion"?: "FeelingAlone", "query"?: "...", "exclude_ids"?: ["uuid"] }
```

Optional `media_id` restricts the search to one interview; without it the whole
vault is searched and `segment.source_media_id` says which interview to open.

Three response shapes:

```jsonc
// crisis — never accompanied by a clip
{ "crisis": true, "message": "...", "resources": [...], "segment": null }

// match
{ "found": true, "segment": { ...full story_segments row... }, "reason": "one warm sentence" }

// nothing suitable
{ "found": false, "segment": null, "message": "..." }
```

The client is built from the **caller's** `Authorization` header, so RLS decides
what that viewer can see. The service-role key is never used.

`emotion` returns the first segment carrying that tag — no LLM call, no cost.
`query` runs the crisis regex first, then asks the model to pick one segment
from **metadata only** (id, title, summary, tags — never transcripts). The model
gets a second say on crisis after the regex. Model choices are cached in memory for
5 minutes per `(vault_id, query, candidate segment ids)` — re-segmentation issues new
ids, so the cache can never return a stale one. The emotion path isn't cached.

### Crisis safety

```bash
node supabase/functions/search/crisis.test.mjs
```

35 cases: 19 phrases that must flag, 16 ordinary searches that must not
("i feel alone", "this assignment is killing me"). Patterns are read out of
`index.ts` so the test cannot drift from what ships. **Treat a failure here as
blocking** — a false negative shows a video clip to someone in crisis.

### Deploying

The function needs `OPENAI_API_KEY` as a Supabase secret. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are injected by the platform automatically — do not set them.

**Option A — Supabase CLI (recommended; keeps it out of your teammate's way)**

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref vofogqdxxmjoqdfcsgen
supabase secrets set OPENAI_API_KEY=sk-proj-... --project-ref vofogqdxxmjoqdfcsgen
supabase functions deploy search --project-ref vofogqdxxmjoqdfcsgen
```

**Option B — via Lovable.** Lovable Cloud deploys anything under
`supabase/functions/`, but the file has to live in the Lovable repo, which means
prompting the Lovable agent while a teammate is editing it. Set the secret in
the Supabase dashboard under Edge Functions -> Secrets.

### Testing

```bash
python scripts/test_search.py --vault-id <uuid>
```

Runs a suite including a crisis phrase and asserts no clip comes back with it.
Single checks: `--query "i feel like a fraud"` or `--emotion FeelingAlone`.

By curl (get a JWT by signing in first):

```bash
TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$PIPELINE_EDITOR_EMAIL\",\"password\":\"$PIPELINE_EDITOR_PASSWORD\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s "$SUPABASE_URL/functions/v1/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vault_id":"<uuid>","query":"i feel like a fraud"}' | python3 -m json.tool
```

## Phase 2b — photo moments and the transcript sidecar

```bash
python scripts/match_photos.py --media-id <uuid>              # link photos to the moment they're mentioned
python scripts/publish.py     --media-id <uuid> --interviewer "Julianna"
```

**match_photos.py** shows the model each photo's title/caption/year plus the
numbered utterances and asks for the utterance where the subject refers to it,
or null. The jump-to time is that utterance's Scribe start. It sets
`story_segments.related_photo_id` (one per segment; earliest mention wins) and
saves every match to `data/<media_id>/photo_moments.json`.

**publish.py** writes what the database has no column for, to storage:

```
interview-videos/{vault_id}/{media_id}.transcript.json   utterances + word timings, speakers, chapters, quotes, photo moments
interview-videos/{vault_id}/{media_id}.vtt               WebVTT captions
interview-videos/{vault_id}/{media_id}-{segment_id}.jpg  chapter thumbnails (ffmpeg frame at start_seconds)
```

Paths are exactly `{vault_id}/{filename}` so the existing storage RLS applies.

Full run for one recording:

```bash
python scripts/transcribe.py   --media-id <uuid>
python scripts/segment.py      --media-id <uuid>
python scripts/match_photos.py --media-id <uuid>
python scripts/publish.py      --media-id <uuid>
```

`segment.py` re-issues segment ids on every run, so `match_photos` and `publish`
must run after it.

### Speakers

`transcribe.py` passes `detect_speaker_roles=True`; Scribe then returns
`agent` (asks the questions) and `customer` (answers). The sidecar labels them
`Interviewer` (or `--interviewer NAME`) and the vault's `subject_name`. Older
transcripts with `speaker_0/1` fall back to "most words = subject".

### Tag policy

- `emotions`, `era` — **closed**, from `scripts/taxonomy.json`. Off-list values dropped.
- `topics`, `wisdom_tags` — **free-form**, model-written, normalised to PascalCase,
  max 4 each. `taxonomy.json` entries are style examples only.
- `hook` (per-chapter theme line) and `quote` (pull-quote chosen by utterance
  number, text from Scribe) live in the sidecar, not the database.

### Fixing a chapter boundary by hand

The model's raw answer is kept at `data/<media_id>/llm_segments.json`. To move a
boundary, edit `start_utterance` / `end_utterance` there (numbers from
`segment.py <key> --dry-run`), then replay — timings and transcript text are
re-derived from Scribe, nothing is typed by hand:

```bash
python scripts/segment.py --media-id <uuid> --replay   # delete + re-insert with new boundaries
python scripts/publish.py --media-id <uuid>            # segment ids changed, so republish
```

Replay also re-applies the current taxonomy and tag normaliser without another
model call, which is how a taxonomy fix (e.g. adding an era) gets into existing
segments.

## Phase 5 — the worker, the AI interviewer, and deleting a recording

### Automatic processing

Nothing has to be run by hand once a recording is saved. Keep the worker up:

```
python -u scripts/worker.py            # poll every 5s; Ctrl-C to stop
python    scripts/worker.py --once     # one pass (useful in CI or a cron)
```

It signs in as the vault editor like every other script, and every few seconds
looks for videos that have no `{media_id}.transcript.json` beside them. Each
one gets `transcribe → segment → match_photos → publish`, with progress written
to `{vault_id}/{media_id}.status.json` in the same folder:

```
{"state": "transcribing" | "chaptering" | "photos" | "publishing" | "done" | "failed",
 "message": "Finding the chapters", "chapters": 3, "steps": [...], "error": "..."}
```

The app reads that file: the vault card shows a live badge, the screening page
shows the step and reloads itself when the state turns `done`. A recording too
short to chapter is still published (transcript, captions, poster) and marked
`done · too short for chapters` rather than failed. A claim older than 30
minutes is treated as a dead worker and picked up again. No tables, no schema.

### The AI interviewer (self-serve tier)

`supabase/functions/interview` runs the guided session: a fixed welcome, then
one question at a time following the ten-part life-story guide in
`supabase/functions/_shared/interview-guide.ts`. Each answer is transcribed by
Scribe before the next question is chosen (OpenAI, JSON mode) so questions
follow what was actually said; a refusal ("I'd rather not talk about that")
closes the part deterministically. Everything the interviewer says comes back
as MP3 from ElevenLabs when `ELEVENLABS_VOICE_ID` is set (library voices need a
paid plan), and the browser mixes that audio into the archive recording so the
questions are in the video whatever the microphone hears. The session plan is
saved as `{media_id}.interview.json` and `segment.py` uses it as chapter hints.

Locally: `PORT=8001 deno run --allow-net --allow-env --env-file=.env supabase/functions/interview/index.ts`
with `VITE_INTERVIEW_URL=http://localhost:8001/` in the frontend env.

### Multilingual

The interviewer works in any of the languages in
`supabase/functions/_shared/languages.ts`. The family picks one at the start
of a guided session, or leaves it on "Let her choose" — then the welcome is in
English and the first answer (Scribe's `language_code`) sets the language for
the rest of the session. Questions, bridges, welcome and farewell are all
generated in that language and spoken by the same voice (`eleven_multilingual_v2`
where it covers the language, `eleven_v3` for Vietnamese, Telugu, Punjabi, …).

Safety in other languages: the regex crisis filter only reads English, so
every answer also goes through `llmCrisis()` in `_shared/crisis.ts` — a small
model, JSON mode, run in parallel with question generation so it adds no
latency. It fails closed. `crisis.llm.test.ts` exercises it in five languages.

In the archive, `segment.py` writes titles, summaries, hooks and tags in
English whatever the language spoken, so the family can search; the
transcript and pull-quotes stay verbatim. `translate.py` (a worker step) adds
an English track: `translations.en` in the sidecar and `{media_id}.en.vtt`.
The screening page shows a "Her words / English" toggle on the transcript and
switches the captions with it.

### Voice search

The Ask box on the vault and screening pages has a microphone. Tap, ask,
tap again: the clip goes to the search function as `audio` (base64), Scribe
transcribes it, and from there it is an ordinary query — same crisis check,
same model, same cache. The transcript comes back and appears in the box.
With `speak: true` the answer's one-line reason (or the crisis / not-found
message) also comes back as MP3 in `audio_b64`, in the language the question
was asked in; the page plays it before the clip starts. The speaker toggle
beside the box remembers itself per browser. Feeling chips honour the same
toggle. Nothing listens except between the two taps.

### Guardrails

What is checked at runtime, deterministically, before anything reaches a person:

- **Crisis** — every query, spoken question and interview answer goes through
  the shared regex (`_shared/crisis.ts`) and, in any language, `llmCrisis()`.
  The model check fails closed. A hit returns helplines and nothing else.
- **Refusal** — "I'd rather not talk about that" ends the part; the server
  decides, not the model.
- **The question itself** — `_shared/guard.ts` vets every draft before it is
  spoken: one question, under 30 words (60 chars in Chinese/Japanese), not
  yes/no, in the session's script, not a repeat, no machinery words. A failed
  draft is retried once with the reasons; a second failure falls back to the
  guide's own prompt. The reply carries `guard: {retried, fallback, reasons}`.
- **Transcript is data** — every prompt that sees spoken words is told they are
  never instructions.
- **Contract** — `segment.py` validates closed tags, boundaries and coverage
  before writing; `publish.py` never writes a segment id it did not read back.

### Evaluations

```
python evals/run.py            # offline: crisis regex, question guard, chapter contract
python evals/run.py --live     # + model crisis check, 17 golden searches, a 16-turn scripted interview
```

Writes `evals/REPORT.md` and fails the build on any must-pass check. The
interview suite drives a simulated elder (`evals/interview_persona.json`, a
fact sheet plus scripted behaviours: a refusal, a one-word answer, a heavy
disclosure) against the live function and checks structure on every turn —
one question, open, no repeats, parts in order, a bridge on each new part,
the refusal ending its part — then a second model grades each question on
builds-on / concrete / warm. Two of the bugs this repo has had would have
been caught by it before shipping: a trimmed crisis list, and a JSON-mode
check that silently returned "no crisis" on every call.

### Deleting a recording

The screening page and the guided session's "saved" state both offer delete.
`src/lib/media-delete.ts` removes the chapters, every sidecar that carries the
recording's id, the video, then the row — RLS decides whether the signed-in
person may. Photographs are separate assets and are never touched.

## Frontend (`frontend/legaseen-source-v2`)

The teammate's TanStack Start UI, wired to this system. Routes:

| Route | Screen | Data |
|---|---|---|
| `/` | sign-in, then the archive (one card per vault) | `vaults`, interview/story counts, first interview's poster |
| `/vault/$vaultId` | one card per interview + vault-wide search | `media_assets` (video/audio), `story_segments`, posters |
| `/screening/$mediaId?seg=` | player, chapters, synced transcript, search scoped to the interview | signed video URL, sidecar, captions, thumbnails |
| `/photographs/$vaultId` | photo folio, "Oral story" links to the moment a photo is mentioned | `media_assets` (photo), `related_photo_id` |

All four are `ssr: false` — Supabase auth lives in the browser. Vault-wide
search navigates to `/screening/$mediaId?seg=<segment id>` and the screening
page seeks there once the player mounts.

```bash
cd frontend/legaseen-source-v2
cp .env.example .env.local             # then fill in VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

`VITE_SEARCH_URL` points at the local Deno search function (`http://localhost:8000/`);
after deploying, set it to `https://<project>.supabase.co/functions/v1/search`.

**Lockfile note.** The zip's `package-lock.json` was generated on Windows and
lists no macOS native bindings (`@oxc-parser/binding-darwin-arm64`, rolldown,
Tailwind oxide, lightningcss), so `npm ci` on a Mac produces a tree the dev server
can't start. A lockfile regenerated with `rm -rf node_modules package-lock.json
&& npm install` records every platform's optional bindings and works on both.

### Sign-in page assets

`frontend/legaseen-source-v2/public/login-portrait.jpg` was generated with
OpenAI `gpt-image-1` (1024×1536) from a written brief — an elder mid-story in a
lamplit study — so it is licensed to the project and depicts no real person.
The full-resolution original is kept in `fixtures/` (gitignored). The logo
files in `public/` are cut from the team's `legaseen-logo.png`.
