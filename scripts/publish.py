#!/usr/bin/env python3
"""Publish the transcript sidecar, captions and chapter thumbnails to storage.

The database has no column for word timings, so the frontend reads them from a
JSON sidecar next to the video:

    interview-videos/{vault_id}/{media_id}.transcript.json   utterances, words, chapters, photo moments
    interview-videos/{vault_id}/{media_id}.vtt               WebVTT captions for <track>
    interview-videos/{vault_id}/{media_id}-{segment_id}.jpg  chapter thumbnails

All paths are exactly {vault_id}/{filename}, which is what the storage RLS
policy needs. Uploads run as the editor through that policy.

    python scripts/publish.py --media-id <uuid> [--interviewer "Julianna"] [--no-thumbnails]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT, VIDEO_BUCKET, die, editor_client, load_env, speaker_label, speaker_roles  # noqa: E402
from segment import build_utterances  # noqa: E402


def put_object(client, bucket: str, path: str, data: bytes, content_type: str) -> None:
    opts = {"content-type": content_type, "upsert": "true"}
    try:
        client.storage.from_(bucket).upload(path, data, opts)
    except Exception as exc:  # noqa: BLE001
        if any(k in str(exc).lower() for k in ("exist", "duplicate")):
            client.storage.from_(bucket).update(path, data, opts)
        else:
            raise


def vtt_time(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def build_vtt(utterances, labels) -> str:
    out = ["WEBVTT", ""]
    for u in utterances:
        out += [f"{vtt_time(u['start'])} --> {vtt_time(u['end'])}",
                f"<v {labels[u['speaker']]}>{u['text']}", ""]
    return "\n".join(out)


def grab_frame(source: Path, seconds: float, dest: Path) -> bool:
    if shutil.which("ffmpeg") is None:
        return False
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", f"{seconds:.2f}",
           "-i", str(source), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", str(dest)]
    return subprocess.run(cmd, capture_output=True).returncode == 0 and dest.exists()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--media-id", required=True)
    ap.add_argument("--interviewer", default=None, help="name to show for the interviewer")
    ap.add_argument("--no-thumbnails", action="store_true")
    args = ap.parse_args()

    load_env()
    ddir = REPO_ROOT / "data" / args.media_id
    tpath, spath, ppath = ddir / "transcript.json", ddir / "segments.json", ddir / "photo_moments.json"
    if not tpath.exists():
        die(f"{tpath} not found — run transcribe.py first")
    doc = json.loads(tpath.read_text())
    words = doc["words"]
    utterances = build_utterances(words)
    roles = speaker_roles(words)
    # No segments.json means the chapter model found nothing to chapter (a very
    # short recording). The transcript, captions and poster still publish.
    segments = json.loads(spath.read_text()) if spath.exists() else []
    moments = json.loads(ppath.read_text()) if ppath.exists() else []
    xpath = ddir / "translation.en.json"
    translation = json.loads(xpath.read_text()) if xpath.exists() else None

    client = editor_client()
    media = client.table("media_assets").select("id,vault_id,title,storage_path,duration_seconds") \
        .eq("id", args.media_id).execute().data
    if not media:
        die("media row not visible")
    media = media[0]
    vault_id = media["vault_id"]
    vault = client.table("vaults").select("subject_name,name").eq("id", vault_id).execute().data
    subject_name = vault[0]["subject_name"] if vault else None

    if segments and any(s.get("id") is None for s in segments):
        db = client.table("story_segments").select("id,start_seconds,end_seconds") \
            .eq("source_media_id", args.media_id).execute().data or []
        by_span = {(d["start_seconds"], d["end_seconds"]): d["id"] for d in db}
        for s in segments:
            s["id"] = by_span.get((s["start_seconds"], s["end_seconds"]))
        if any(s.get("id") is None for s in segments):
            die("segment ids missing — re-run segment.py without --no-write")

    labels = {sid: (args.interviewer or "Interviewer") if role == "interviewer"
              else speaker_label(role, subject_name) for sid, role in roles.items()}
    print(f"  media : {media['title']!r}  vault={vault_id}")
    print(f"  labels: {labels}")

    # --- thumbnails ---
    thumbs: dict[str, str] = {}
    source = next(iter(sorted(ddir.glob("source.*"))), None)
    if args.no_thumbnails:
        # Keep pointing at frames from an earlier run rather than blanking them.
        have = {o.get("name") for o in (client.storage.from_(VIDEO_BUCKET).list(vault_id) or [])}
        for s in segments:
            name = f"{args.media_id}-{s['id']}.jpg"
            if name in have:
                thumbs[s["id"]] = f"{vault_id}/{name}"
        print(f"  thumbs: skipped (--no-thumbnails); {len(thumbs)}/{len(segments)} existing frames kept")
    elif source is None:
        print("  thumbs: skipped — no data/<media_id>/source.* (re-run transcribe.py --media-id)")
    else:
        tdir = ddir / "thumbs"; tdir.mkdir(exist_ok=True)
        stale = [f"{vault_id}/{o['name']}" for o in (client.storage.from_(VIDEO_BUCKET).list(vault_id) or [])
                 if o.get("name", "").startswith(f"{args.media_id}-") and o["name"].endswith(".jpg")]
        if stale:
            client.storage.from_(VIDEO_BUCKET).remove(stale)
            print(f"  thumbs: removed {len(stale)} stale thumbnail(s) from earlier runs")
        for s in segments:
            # a little past the start so we don't land on a cut
            local = tdir / f"{s['id']}.jpg"
            if grab_frame(source, s["start_seconds"] + 0.5, local):
                obj = f"{vault_id}/{args.media_id}-{s['id']}.jpg"
                put_object(client, VIDEO_BUCKET, obj, local.read_bytes(), "image/jpeg")
                thumbs[s["id"]] = obj
        print(f"  thumbs: {len(thumbs)}/{len(segments)} uploaded")

    # --- poster frame for the interview card (vault screen) ---
    poster_path = None
    if args.no_thumbnails:
        name = f"{args.media_id}-poster.jpg"
        if name in have:
            poster_path = f"{vault_id}/{name}"
    elif source is not None:
        local = ddir / "poster.jpg"
        first = segments[0]["start_seconds"] + 0.5 if segments else 1.0
        if grab_frame(source, first, local):
            poster_path = f"{vault_id}/{args.media_id}-poster.jpg"
            put_object(client, VIDEO_BUCKET, poster_path, local.read_bytes(), "image/jpeg")
            print(f"  poster: {VIDEO_BUCKET}/{poster_path}")

    # --- sidecar ---
    chapters = []
    for s in segments:
        chapters.append({
            "segment_id": s["id"],
            "title": s["title"], "summary": s.get("summary"), "hook": s.get("hook") or None,
            "start_seconds": s["start_seconds"], "end_seconds": s["end_seconds"],
            "utterances": s.get("utterances"),
            "quote": s.get("quote"),
            "thumbnail_path": thumbs.get(s["id"]),
            "topics": s.get("topics", []), "emotions": s.get("emotions", []),
            "wisdom_tags": s.get("wisdom_tags", []), "era": s.get("era", []),
            "related_photo_id": next((m["photo_id"] for m in moments if m.get("segment_id") == s["id"]), None),
        })
    sidecar = {
        "version": 1,
        "media_id": args.media_id, "vault_id": vault_id, "title": media["title"],
        "duration": doc.get("audio_duration_secs"), "language": doc.get("language_code"),
        "model_id": doc.get("model_id"),
        "speakers": {sid: {"label": labels[sid], "role": roles[sid]} for sid in roles},
        "utterances": [{"n": u["n"], "speaker": u["speaker"], "start": u["start"], "end": u["end"],
                        "text": u["text"], "words": u["words"]} for u in utterances],
        "chapters": chapters,
        "photo_moments": moments,
        "captions_path": f"{vault_id}/{args.media_id}.vtt",
        "captions_en_path": f"{vault_id}/{args.media_id}.en.vtt" if translation else None,
        "translations": {"en": translation["utterances"]} if translation else {},
        "poster_path": poster_path,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    sidecar_bytes = json.dumps(sidecar, ensure_ascii=False).encode()
    vtt = build_vtt(utterances, labels).encode()
    (ddir / "sidecar.json").write_bytes(sidecar_bytes)
    (ddir / "captions.vtt").write_bytes(vtt)

    sc_path = f"{vault_id}/{args.media_id}.transcript.json"
    vtt_path = f"{vault_id}/{args.media_id}.vtt"
    put_object(client, VIDEO_BUCKET, sc_path, sidecar_bytes, "application/json")
    put_object(client, VIDEO_BUCKET, vtt_path, vtt, "text/vtt")
    if translation:
        en_utts = [{**u, "text": translation["utterances"].get(str(u["n"]), u["text"])} for u in utterances]
        en_vtt = build_vtt(en_utts, labels).encode()
        (ddir / "captions.en.vtt").write_bytes(en_vtt)
        put_object(client, VIDEO_BUCKET, f"{vault_id}/{args.media_id}.en.vtt", en_vtt, "text/vtt")
        print(f"  en vtt : {VIDEO_BUCKET}/{vault_id}/{args.media_id}.en.vtt  ({len(en_utts)} utterances translated)")

    print(f"  sidecar: {VIDEO_BUCKET}/{sc_path}  ({len(sidecar_bytes) / 1024:.1f} KB, "
          f"{len(utterances)} utterances, {len(chapters)} chapters, {len(moments)} photo moments)")
    print(f"  vtt    : {VIDEO_BUCKET}/{vtt_path}")

    # prove a viewer can actually get it back
    signed = client.storage.from_(VIDEO_BUCKET).create_signed_url(sc_path, 60)
    print(f"  signed : {'ok' if signed.get('signedURL') or signed.get('signedUrl') else 'FAILED'}")


if __name__ == "__main__":
    main()
