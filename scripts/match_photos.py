#!/usr/bin/env python3
"""Match archival photos to the moment in the interview where they're mentioned.

The model sees the photos' titles/captions and the numbered utterances and
returns, per photo, an utterance number or null. The jump-to timestamp is the
Scribe start time of that utterance — never something the model wrote.

Writes story_segments.related_photo_id (one photo per segment; earliest match
wins) and data/<media_id>/photo_moments.json with every match for the sidecar.

    python scripts/match_photos.py --media-id <uuid> [--no-write] [--replay]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT, die, editor_client, load_env, require_env, speaker_label, speaker_roles  # noqa: E402
from segment import build_utterances  # noqa: E402

SYSTEM_PROMPT = """You link archival family photographs to the moment in an oral-history \
interview where the subject talks about what the photo shows.

You get numbered utterances and a list of photos (title, caption, year). For EACH \
photo return the single utterance number where the subject most directly refers to \
the people, place or event in that photo -- or null if the interview never clearly \
does. Be strict: a photo of a beach trip is NOT matched to a story about work just \
because both are in the past. Prefer the Subject's utterances over the Interviewer's.

- The subject is speaking TO the interviewer, usually a grandchild or great-grandchild. Resolve relationships from the SUBJECT's point of view: "your grandfather" is the subject's husband, "your mum" is her daughter. Never write "her grandfather" for someone the subject calls "your grandfather".

blurb: at most 12 words, third person past tense, saying what she says that connects \
to the photo -- e.g. "Spoke about the coal dust on the washing". Empty string if null.

Return JSON of the exact form:
{"matches": [{"photo_id": "<id>", "utterance": <int or null>, "blurb": "..."}]}
Include every photo exactly once."""


def call_llm(utterances, roles, photos) -> list[dict]:
    from openai import OpenAI
    model = os.environ.get("OPENAI_SEGMENT_MODEL", "gpt-4.1").strip() or "gpt-4.1"
    lines = "\n".join(
        f"[{u['n']}] ({speaker_label(roles.get(u['speaker'], ''), None)}) {u['text']}" for u in utterances)
    menu = [{"photo_id": p["id"], "title": p["title"], "caption": p.get("caption"),
             "taken_year": p.get("taken_year")} for p in photos]
    print(f"  llm   : model={model} utterances={len(utterances)} photos={len(photos)} (JSON mode)")
    client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    try:
        resp = client.chat.completions.create(
            model=model, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM_PROMPT},
                      {"role": "user", "content": f"Photos:\n{json.dumps(menu, indent=2)}\n\nInterview:\n{lines}"}])
    except Exception as exc:  # noqa: BLE001
        die(f"OpenAI request failed: {exc}")
    try:
        data = json.loads(resp.choices[0].message.content)
    except (json.JSONDecodeError, TypeError) as exc:
        die(f"model did not return valid JSON: {exc}")
    matches = data.get("matches")
    if not isinstance(matches, list):
        die(f"model JSON had no 'matches' list (keys: {list(data)})")
    if resp.usage:
        print(f"  tokens: {resp.usage.prompt_tokens} in / {resp.usage.completion_tokens} out")
    return matches


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--media-id", required=True)
    ap.add_argument("--no-write", action="store_true", help="don't touch related_photo_id")
    ap.add_argument("--replay", action="store_true", help="reuse saved llm_photo_matches.json")
    args = ap.parse_args()

    load_env()
    ddir = REPO_ROOT / "data" / args.media_id
    tpath, spath = ddir / "transcript.json", ddir / "segments.json"
    if not tpath.exists():
        die(f"{tpath} not found — run transcribe.py first")
    if not spath.exists():
        die(f"{spath} not found — run segment.py first")
    doc = json.loads(tpath.read_text())
    words = doc["words"]
    utterances = build_utterances(words)
    roles = speaker_roles(words)
    segments = json.loads(spath.read_text())

    client = editor_client()
    vault_id = (doc.get("media_asset") or {}).get("vault_id")
    if not vault_id:
        r = client.table("media_assets").select("vault_id").eq("id", args.media_id).execute().data
        if not r:
            die("media row not visible")
        vault_id = r[0]["vault_id"]

    # Segment ids: prefer the ones saved by segment.py, else look them up.
    if any(s.get("id") is None for s in segments):
        db = client.table("story_segments").select("id,start_seconds,end_seconds") \
            .eq("source_media_id", args.media_id).execute().data or []
        by_span = {(d["start_seconds"], d["end_seconds"]): d["id"] for d in db}
        for s in segments:
            s["id"] = by_span.get((s["start_seconds"], s["end_seconds"]))
        if any(s.get("id") is None for s in segments):
            die("could not resolve segment ids from the database — re-run segment.py without --no-write")

    photos = client.table("media_assets") \
        .select("id,title,caption,taken_year,storage_path") \
        .eq("vault_id", vault_id).eq("media_type", "photo").order("taken_year").execute().data or []
    if not photos:
        die("no photos in this vault (media_type='photo') — nothing to match")
    print(f"  vault : {vault_id}  photos={len(photos)}  segments={len(segments)}")

    raw = ddir / "llm_photo_matches.json"
    if args.replay:
        if not raw.exists():
            die(f"{raw} not found")
        matches = json.loads(raw.read_text())
        print(f"  llm   : replaying {raw.name}")
    else:
        matches = call_llm(utterances, roles, photos)
        raw.write_text(json.dumps(matches, indent=2, ensure_ascii=False))

    by_n = {u["n"]: u for u in utterances}
    photo_by_id = {p["id"]: p for p in photos}

    def segment_for(n: int):
        for s in segments:
            a, b = s.get("utterances") or (None, None)
            if a is not None and a <= n <= b:
                return s
        t = by_n[n]["start"]
        for s in segments:                      # fall back to time containment
            if s["start_seconds"] <= t <= s["end_seconds"]:
                return s
        return None

    moments, unmatched, problems = [], [], []
    for m in matches:
        pid = m.get("photo_id")
        if pid not in photo_by_id:
            problems.append(f"unknown photo_id {pid!r}"); continue
        n = m.get("utterance")
        if n is None:
            unmatched.append(photo_by_id[pid]["title"]); continue
        try:
            n = int(n)
        except (TypeError, ValueError):
            problems.append(f"{photo_by_id[pid]['title']!r}: bad utterance {n!r}"); continue
        if n not in by_n:
            problems.append(f"{photo_by_id[pid]['title']!r}: utterance {n} out of range"); continue
        seg = segment_for(n)
        p = photo_by_id[pid]
        moments.append({
            "photo_id": pid, "title": p["title"], "caption": p.get("caption"),
            "taken_year": p.get("taken_year"), "storage_path": p["storage_path"],
            "utterance": n, "seconds": by_n[n]["start"],          # Scribe time, not the model's
            "segment_id": seg["id"] if seg else None,
            "blurb": (m.get("blurb") or "").strip()[:120],
        })
    moments.sort(key=lambda x: x["seconds"])

    print()
    for x in moments:
        print(f"  {x['seconds']:>6.2f}s  [{x['utterance']:>2}]  {x['title']!r}")
        print(f"           -> \"{x['blurb']}\"   segment={x['segment_id'] or '(none)'}")
    if unmatched:
        print(f"\n  no moment found for: {', '.join(repr(t) for t in unmatched)}")
    for p in problems:
        print(f"  problem: {p}")

    (ddir / "photo_moments.json").write_text(json.dumps(moments, indent=2, ensure_ascii=False))
    print(f"\n  saved {ddir.relative_to(REPO_ROOT)}/photo_moments.json ({len(moments)} matches)")

    if args.no_write:
        print("  --no-write: related_photo_id untouched")
        return

    # One photo per segment in the schema; earliest mention wins. Reset first so
    # re-runs don't leave stale links behind.
    client.table("story_segments").update({"related_photo_id": None}) \
        .eq("source_media_id", args.media_id).execute()
    linked: dict[str, str] = {}
    for x in moments:
        sid = x["segment_id"]
        if sid and sid not in linked:
            try:
                client.table("story_segments").update({"related_photo_id": x["photo_id"]}).eq("id", sid).execute()
                linked[sid] = x["title"]
            except Exception as exc:  # noqa: BLE001
                die(f"update rejected by database: {exc}")
    print(f"  related_photo_id set on {len(linked)} segment(s):")
    for sid, title in linked.items():
        print(f"    {sid}  <- {title!r}")


if __name__ == "__main__":
    main()
