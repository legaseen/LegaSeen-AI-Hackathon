#!/usr/bin/env python3
"""Create a demo vault + media asset so the pipeline has something to point at.

Everything here runs as the signed-in editor through the anon key, so RLS and
the validation triggers apply. No schema changes, no service-role key.

    python scripts/bootstrap_demo.py --video fixtures/test_interview.wav \
        --vault-name "Nan's Vault" --subject "Margaret Whitfield"
"""
from __future__ import annotations

import argparse
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import VIDEO_BUCKET, die, editor_client, load_env  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="local video/audio file to upload")
    ap.add_argument("--vault-name", default="Demo Vault")
    ap.add_argument("--subject", default="Margaret Whitfield")
    ap.add_argument("--title", default=None, help="media title (defaults to filename)")
    ap.add_argument("--vault-id", default=None, help="reuse an existing vault instead of creating one")
    args = ap.parse_args()

    path = Path(args.video).expanduser().resolve()
    if not path.exists():
        die(f"{path} does not exist")

    load_env()
    client = editor_client()
    user = client.auth.get_user()
    uid = user.user.id if user and user.user else None
    if not uid:
        die("could not resolve the signed-in user id")

    # --- vault ---
    if args.vault_id:
        vault_id = args.vault_id
        rows = client.table("vaults").select("id,name").eq("id", vault_id).execute().data or []
        if not rows:
            die(f"vault {vault_id} not visible to this account")
        print(f"  using existing vault {vault_id} ({rows[0]['name']!r})")
    else:
        res = client.table("vaults").insert({
            "owner_id": uid,
            "name": args.vault_name,
            "subject_name": args.subject,
            "description": "Created by scripts/bootstrap_demo.py for pipeline testing.",
        }).execute()
        if not res.data:
            die("vault insert returned no row")
        vault_id = res.data[0]["id"]
        print(f"  created vault {vault_id} ({args.vault_name!r}, subject {args.subject!r})")

    # --- storage: must be exactly {vault_id}/{filename} for storage RLS ---
    object_name = f"{vault_id}/{path.name}"
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    print(f"  uploading {path.name} ({path.stat().st_size / 1e6:.1f} MB) -> {VIDEO_BUCKET}/{object_name}")
    try:
        client.storage.from_(VIDEO_BUCKET).upload(
            object_name,
            path.read_bytes(),
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001
        die(f"upload failed: {exc}\n"
            f"       If this says the bucket is missing, someone must create "
            f"'{VIDEO_BUCKET}' as a PRIVATE bucket in the Supabase dashboard.")

    # --- media_assets row ---
    media_type = "audio" if content_type.startswith("audio") else "video"
    res = client.table("media_assets").insert({
        "vault_id": vault_id,
        "uploaded_by": uid,
        "title": args.title or path.stem.replace("_", " ").title(),
        "media_type": media_type,
        "storage_path": object_name,
        "mime_type": content_type,
    }).execute()
    if not res.data:
        die("media_assets insert returned no row")
    media_id = res.data[0]["id"]

    print(f"  created media_assets {media_id} (media_type={media_type})")
    print()
    print("  Next:")
    print(f"    .venv/bin/python scripts/transcribe.py --media-id {media_id}")
    print(f"    .venv/bin/python scripts/segment.py    --media-id {media_id}")
    print(f"    .venv/bin/python scripts/test_search.py --vault-id {vault_id}")
    print()
    print(f"  VAULT_ID={vault_id}")
    print(f"  MEDIA_ID={media_id}")


if __name__ == "__main__":
    main()
