#!/usr/bin/env python
"""
Put the demo recording back after someone deletes it.

    python scripts/restore_demo.py            # restore if missing
    python scripts/restore_demo.py --force    # rebuild even if the row exists

The judges' account is a vault editor, so it can delete Ria's recording. This
rebuilds it from `data/<media_id>/` — the video, the Scribe transcript and the
saved model output — reusing the original media id so the data folder, the
photo matches and the storage paths all line up again.

Nothing here calls OpenAI or ElevenLabs: segmentation and photo matching are
replayed from the JSON saved on the first run, so a restore is free and gives
the same chapters.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT, VIDEO_BUCKET, die, editor_client, load_env  # noqa: E402

MEDIA_ID = "0479c532-8e6f-42e9-a52e-9e651778c94f"
VAULT_ID = "e2daf039-8504-46de-a96a-a9ffb0838b1b"
TITLE = "Her 100th Birthday, San Diego"
STORAGE_PATH = f"{VAULT_ID}/100yolady-20mins-compressed.mp4"
DURATION = 1212


def run(script: str, *args: str) -> None:
    cmd = [sys.executable, str(REPO_ROOT / "scripts" / script), "--media-id", MEDIA_ID, *args]
    p = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    tail = "\n".join((p.stdout + p.stderr).strip().splitlines()[-4:])
    print(f"  {script:18} {'ok' if p.returncode == 0 else 'FAILED'}")
    if p.returncode != 0:
        die(f"{script} failed:\n{tail}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Restore the demo recording.")
    ap.add_argument("--force", action="store_true", help="rebuild even if the row is present")
    args = ap.parse_args()
    load_env()

    ddir = REPO_ROOT / "data" / MEDIA_ID
    source = ddir / "source.mp4"
    if not source.exists():
        die(f"{source} is missing — nothing to restore from")

    client = editor_client()
    existing = client.table("media_assets").select("id").eq("id", MEDIA_ID).execute().data
    if existing and not args.force:
        print("  recording is already present — nothing to do (use --force to rebuild)")
        return

    # 1. the video itself
    names = {o["name"] for o in (client.storage.from_(VIDEO_BUCKET).list(VAULT_ID, {"limit": 1000}) or [])}
    obj = STORAGE_PATH.split("/", 1)[1]
    if obj not in names:
        client.storage.from_(VIDEO_BUCKET).upload(STORAGE_PATH, source.read_bytes(), {"content-type": "video/mp4"})
        print(f"  video              uploaded ({source.stat().st_size / 1e6:.0f} MB)")
    else:
        print("  video              already in storage")

    # 2. the row, with its original id so everything derived still matches
    uid = client.auth.get_user().user.id
    if not existing:
        client.table("media_assets").insert({
            "id": MEDIA_ID, "vault_id": VAULT_ID, "uploaded_by": uid, "media_type": "video",
            "title": TITLE, "storage_path": STORAGE_PATH, "mime_type": "video/mp4",
            "duration_seconds": DURATION,
        }).execute()
        print("  media_assets       row recreated")

    # 3. chapters, photo links and the sidecar — replayed, so no API cost
    run("segment.py", "--replay")
    if (ddir / "llm_photo_matches.json").exists():
        run("match_photos.py", "--replay")
    run("publish.py", "--interviewer", "Interviewer")

    segs = client.table("story_segments").select("id", count="exact").eq("source_media_id", MEDIA_ID).execute()
    print(f"\nrestored: {segs.count} chapters, sidecar and captions republished")


if __name__ == "__main__":
    main()
