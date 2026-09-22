#!/usr/bin/env python
"""
Watches the archive for new recordings and runs the pipeline on each one.

    python scripts/worker.py            # keep running; poll every 5s
    python scripts/worker.py --once     # one pass, then exit

A recording is "new" when the vault has no `{media_id}.transcript.json` beside
it and no `{media_id}.status.json` saying it is being handled. Progress is
written to that status file — the app reads it to show "Transcribing…",
"Finding chapters…" and so on — which keeps the whole thing inside the
sidecar pattern: no new tables, no schema changes.

Signs in as the vault editor with the anon key, like every other script, so it
only ever sees vaults it has been made an editor of.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT, VIDEO_BUCKET, editor_client, load_env  # noqa: E402

POLL_SECONDS = 5
STALE_MINUTES = 30            # an in-progress claim older than this is reclaimed
RESIGNIN_MINUTES = 45         # the editor's JWT lasts an hour; sign in again well before
SCRIPTS = REPO_ROOT / "scripts"

STEPS = [
    # state         script             label shown in the app
    ("transcribing", "transcribe.py",   "Transcribing with Scribe"),
    ("chaptering",   "segment.py",      "Finding the chapters"),
    ("translating",  "translate.py",    "Translating for the family"),
    ("photos",       "match_photos.py", "Matching photographs"),
    ("publishing",   "publish.py",      "Publishing to the vault"),
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def put_json(client, path: str, body: dict) -> None:
    data = json.dumps(body, ensure_ascii=False).encode()
    opts = {"content-type": "application/json", "upsert": "true"}
    try:
        client.storage.from_(VIDEO_BUCKET).upload(path, data, opts)
    except Exception as exc:  # noqa: BLE001
        if any(k in str(exc).lower() for k in ("exist", "duplicate")):
            client.storage.from_(VIDEO_BUCKET).update(path, data, opts)
        else:
            raise


def get_json(client, path: str) -> dict | None:
    try:
        return json.loads(client.storage.from_(VIDEO_BUCKET).download(path))
    except Exception:  # noqa: BLE001
        return None


def run_step(script: str, media_id: str) -> tuple[int, str]:
    cmd = [sys.executable, str(SCRIPTS / script), "--media-id", media_id]
    if script == "publish.py":
        cmd += ["--interviewer", "Interviewer"]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    out = (proc.stdout + proc.stderr).strip()
    return proc.returncode, out


def process(client, vault_id: str, media_id: str, title: str) -> None:
    status_path = f"{vault_id}/{media_id}.status.json"
    started = now()
    status = {"media_id": media_id, "state": "queued", "started_at": started, "updated_at": started, "steps": []}

    def update(state: str, message: str, **extra) -> None:
        status.update({"state": state, "message": message, "updated_at": now(), **extra})
        put_json(client, status_path, status)
        print(f"  [{media_id[:8]}] {state:12} {message}")

    print(f"\n{now()}  processing {title!r} ({media_id})")
    chapters = 0
    for state, script, label in STEPS:
        if script == "match_photos.py" and chapters == 0:
            status["steps"].append({"step": state, "skipped": "no chapters"})
            continue
        update(state, label)
        t0 = time.time()
        code, out = run_step(script, media_id)
        secs = round(time.time() - t0, 1)
        tail = "\n".join(out.splitlines()[-6:])
        status["steps"].append({"step": state, "seconds": secs, "ok": code == 0, "tail": tail})

        if script == "segment.py" and code != 0 and "no usable segments" in out:
            # Too short to chapter. Not a failure: the transcript still publishes.
            chapters = 0
            print(f"  [{media_id[:8]}] chaptering   nothing to chapter ({secs}s)")
            continue
        if code != 0:
            update("failed", f"{label} failed", error=tail)
            return
        if script == "segment.py":
            seg_file = REPO_ROOT / "data" / media_id / "segments.json"
            chapters = len(json.loads(seg_file.read_text())) if seg_file.exists() else 0

    update("done", f"Ready · {chapters} chapter{'s' if chapters != 1 else ''}" if chapters else "Ready · too short for chapters",
           chapters=chapters, finished_at=now())


def find_work(client) -> list[tuple[str, str, str]]:
    """(vault_id, media_id, title) for every recording that needs the pipeline."""
    work = []
    vaults = client.table("vaults").select("id").execute().data or []
    for v in vaults:
        vault_id = v["id"]
        names = {o.get("name") for o in (client.storage.from_(VIDEO_BUCKET).list(vault_id, {"limit": 1000}) or [])}
        media = client.table("media_assets").select("id,title,created_at") \
            .eq("vault_id", vault_id).eq("media_type", "video").order("created_at").execute().data or []
        for m in media:
            mid = m["id"]
            if f"{mid}.transcript.json" in names:
                continue
            if f"{mid}.status.json" in names:
                st = get_json(client, f"{vault_id}/{mid}.status.json") or {}
                state = st.get("state")
                if state in ("done", "failed"):
                    continue
                if state and state != "queued":
                    # Someone is on it — unless they died a while ago.
                    try:
                        age = (datetime.now(timezone.utc) - datetime.fromisoformat(st.get("updated_at", ""))).total_seconds()
                    except ValueError:
                        age = STALE_MINUTES * 60 + 1
                    if age < STALE_MINUTES * 60:
                        continue
                    print(f"  reclaiming stale job {mid[:8]} ({state}, {age / 60:.0f} min old)")
            work.append((vault_id, mid, m["title"]))
    return work


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the pipeline on new recordings as they arrive.")
    ap.add_argument("--once", action="store_true", help="one pass, then exit")
    ap.add_argument("--poll", type=int, default=POLL_SECONDS)
    args = ap.parse_args()

    load_env()
    client = editor_client()
    signed_in_at = time.time()
    print(f"worker: watching for new recordings every {args.poll}s (Ctrl-C to stop)")
    while True:
        # A session token lasts an hour; this process is meant to run for weeks.
        if time.time() - signed_in_at > RESIGNIN_MINUTES * 60:
            client = editor_client(); signed_in_at = time.time()
            print("  worker: signed in again")
        try:
            for vault_id, media_id, title in find_work(client):
                process(client, vault_id, media_id, title)
        except KeyboardInterrupt:
            raise
        except Exception as exc:  # noqa: BLE001
            if "JWT" in str(exc) or "PGRST303" in str(exc) or "expired" in str(exc).lower():
                print("  worker: session expired, signing in again")
                client = editor_client(); signed_in_at = time.time()
                continue
            print(f"  worker: pass failed, will retry: {exc}")
        if args.once:
            return
        time.sleep(args.poll)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nworker: stopped")
