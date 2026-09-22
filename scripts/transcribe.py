#!/usr/bin/env python3
"""Phase 1 — transcription.

Transcribes an interview with ElevenLabs Scribe v2, keeping word-level
timestamps and speaker diarization. Transcript text and every timestamp come
from Scribe and are never touched by an LLM.

Usage:
    python scripts/transcribe.py path/to/interview.mp4
    python scripts/transcribe.py --media-id 3f2b...  # pulls from Supabase storage

Output:
    data/<media_id or filename>/transcript.json
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    REPO_ROOT,
    VIDEO_BUCKET,
    die,
    editor_client,
    load_env,
    require_env,
    storage_object_path,
)

SIGNED_URL_TTL_SECONDS = 600


# ---------------------------------------------------------------- media fetch

def fetch_media(media_id: str, out_dir: Path) -> tuple[Path, dict, None]:
    """Sign in as editor, resolve the media row, download it into out_dir."""
    import httpx

    client = editor_client()

    resp = (
        client.table("media_assets")
        .select("id,vault_id,title,media_type,storage_path,mime_type,duration_seconds")
        .eq("id", media_id)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        die(
            f"no media_assets row visible for id {media_id}. "
            "Either it does not exist, or the pipeline account is not a member of that vault."
        )
    row = rows[0]

    if row["media_type"] not in ("video", "audio"):
        die(
            f"media_type is '{row['media_type']}'. story_segments.source_media_id "
            "must point at a video or audio asset (enforced by story_segments_validate_media)."
        )

    obj = storage_object_path(row["storage_path"], VIDEO_BUCKET)
    print(f"  media : {row['title']!r} ({row['media_type']})")
    print(f"  vault : {row['vault_id']}")
    print(f"  object: {VIDEO_BUCKET}/{obj}")

    try:
        signed = client.storage.from_(VIDEO_BUCKET).create_signed_url(obj, SIGNED_URL_TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001
        die(f"could not sign {VIDEO_BUCKET}/{obj}: {exc}")
    url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    if not url:
        die(f"signed URL response had no URL field: {list(signed)}")

    suffix = Path(obj).suffix or ".bin"
    dest = out_dir / f"source{suffix}"
    if dest.exists():
        print(f"  source : already downloaded ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest, row, None
    print(f"  downloading (signed URL, {SIGNED_URL_TTL_SECONDS}s TTL)…")
    with httpx.stream("GET", url, timeout=300.0, follow_redirects=True) as r:
        if r.status_code != 200:
            die(f"download failed with HTTP {r.status_code}")
        with dest.open("wb") as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
    print(f"  downloaded {dest.stat().st_size / 1e6:.1f} MB")
    return dest, row, None


# ------------------------------------------------------------------- ffmpeg

def extract_audio(src: Path, out_wav: Path) -> None:
    """Mono 16 kHz PCM — what Scribe wants, and far smaller than the video."""
    if shutil.which("ffmpeg") is None:
        die("ffmpeg not found on PATH. Install it with: brew install ffmpeg")
    cmd = [
        "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
        "-i", str(src),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(out_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        die(f"ffmpeg failed:\n{proc.stderr.strip()}")
    print(f"  audio : mono 16 kHz wav, {out_wav.stat().st_size / 1e6:.1f} MB")


# ------------------------------------------------------------------- scribe

def load_keyterms(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        die(f"{path} is not valid JSON: {exc}")
    terms = data.get("keyterms", data) if isinstance(data, dict) else data
    if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
        die(f"{path} must contain a list of strings (or {{'keyterms': [...]}})")
    return [t.strip() for t in terms if t.strip()]


def transcribe(wav: Path, keyterms: list[str], language: str | None, num_speakers: int | None) -> dict:
    from elevenlabs.client import ElevenLabs

    api_key = require_env("ELEVENLABS_API_KEY")
    model_id = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v2").strip() or "scribe_v2"

    # Only pass options we actually set — the SDK uses a sentinel for "omitted",
    # and an explicit None serialises as null.
    kwargs = {
        "model_id": model_id,
        "diarize": True,
        "timestamps_granularity": "word",
        "tag_audio_events": True,
        "detect_speaker_roles": True,   # speaker ids become 'agent' / 'customer'
    }
    if keyterms:
        kwargs["keyterms"] = keyterms
    if language:
        kwargs["language_code"] = language
    if num_speakers:
        kwargs["num_speakers"] = num_speakers

    print(f"  scribe: model={model_id} diarize=True granularity=word"
          + (f" keyterms={len(keyterms)}" if keyterms else ""))

    client = ElevenLabs(api_key=api_key)
    with wav.open("rb") as fh:
        try:
            res = client.speech_to_text.convert(file=fh, **kwargs)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "model" in msg.lower() and model_id in msg:
                die(f"Scribe rejected model_id '{model_id}'. "
                    f"Set ELEVENLABS_STT_MODEL in .env to the correct id.\n{msg}")
            die(f"Scribe request failed: {msg}")

    return res.model_dump() if hasattr(res, "model_dump") else json.loads(res.json())


# --------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="Transcribe an interview with ElevenLabs Scribe v2.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("source", nargs="?", help="local video/audio file")
    src.add_argument("--media-id", help="media_assets.id to pull from Supabase storage")
    ap.add_argument("--keyterms", default=str(REPO_ROOT / "config" / "keyterms.json"))
    ap.add_argument("--out", default=str(REPO_ROOT / "data"))
    ap.add_argument("--language", default=None, help="ISO code, e.g. 'en'. Omit to auto-detect.")
    ap.add_argument("--num-speakers", type=int, default=None)
    ap.add_argument("--keep-audio", action="store_true", help="keep the extracted wav next to the transcript")
    args = ap.parse_args()

    load_env()

    tmpdir: Path | None = None
    media_row: dict | None = None

    if args.media_id:
        out_key = args.media_id
        media_dir = Path(args.out) / out_key
        media_dir.mkdir(parents=True, exist_ok=True)
        media_path, media_row, tmpdir = fetch_media(args.media_id, media_dir)
    else:
        media_path = Path(args.source).expanduser().resolve()
        if not media_path.exists():
            die(f"{media_path} does not exist")
        out_key = media_path.stem
        print(f"  media : {media_path.name}")

    out_dir = Path(args.out) / out_key
    out_dir.mkdir(parents=True, exist_ok=True)

    wav = (out_dir / "audio.wav") if args.keep_audio else Path(tempfile.mkdtemp(prefix="legaseen-wav-")) / "audio.wav"
    wav.parent.mkdir(parents=True, exist_ok=True)

    try:
        extract_audio(media_path, wav)
        payload = transcribe(wav, load_keyterms(Path(args.keyterms)), args.language, args.num_speakers)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
        if not args.keep_audio:
            shutil.rmtree(wav.parent, ignore_errors=True)

    words = payload.get("words") or []
    spoken = [w for w in words if w.get("type") == "word"]
    events = [w for w in words if w.get("type") == "audio_event"]
    speakers = sorted({w.get("speaker_id") for w in words if w.get("speaker_id")})

    record = {
        "media_id": args.media_id,
        "source_file": None if args.media_id else str(media_path),
        "media_asset": media_row,
        "model_id": payload.get("model_id") or os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v2"),
        "language_code": payload.get("language_code"),
        "language_probability": payload.get("language_probability"),
        "audio_duration_secs": payload.get("audio_duration_secs"),
        "text": payload.get("text"),
        "words": words,
    }
    out_file = out_dir / "transcript.json"
    out_file.write_text(json.dumps(record, indent=2, ensure_ascii=False))

    dur = payload.get("audio_duration_secs") or (spoken[-1].get("end") if spoken else 0) or 0
    print()
    print(f"  words      : {len(spoken)} spoken ({len(events)} audio events, {len(words)} tokens total)")
    print(f"  duration   : {dur:.1f}s  ({int(dur) // 60}m {int(dur) % 60}s)")
    print(f"  language   : {record['language_code']} (p={record['language_probability']})")
    print(f"  speakers   : {', '.join(speakers) if speakers else '(none returned)'}")
    print(f"  written    : {out_file.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
