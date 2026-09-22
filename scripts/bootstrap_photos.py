#!/usr/bin/env python3
"""Upload demo photos into archival-photos and create their media_assets rows.

Runs as the signed-in editor through RLS. Idempotent: a photo whose
storage_path already has a media_assets row in this vault is skipped.

    python scripts/bootstrap_photos.py --vault-id <uuid> --manifest fixtures/photos/manifest.json
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import PHOTO_BUCKET, die, editor_client, load_env  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault-id", required=True)
    ap.add_argument("--manifest", required=True, help="JSON list of {file,title,caption,taken_year}")
    args = ap.parse_args()

    manifest = Path(args.manifest).expanduser().resolve()
    if not manifest.exists():
        die(f"{manifest} not found")
    items = json.loads(manifest.read_text())

    load_env()
    client = editor_client()
    uid = client.auth.get_user().user.id

    existing = {
        r["storage_path"]
        for r in (client.table("media_assets").select("storage_path")
                  .eq("vault_id", args.vault_id).eq("media_type", "photo").execute().data or [])
    }

    created = skipped = 0
    for it in items:
        path = manifest.parent / it["file"]
        if not path.exists():
            die(f"{path} listed in manifest but missing")
        obj = f"{args.vault_id}/{path.name}"          # exactly {vault_id}/{filename} for storage RLS
        if obj in existing:
            print(f"  skip   {it['title']!r} (already in vault)")
            skipped += 1
            continue
        ct = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        try:
            client.storage.from_(PHOTO_BUCKET).upload(obj, path.read_bytes(),
                                                      {"content-type": ct, "upsert": "true"})
        except Exception as exc:  # noqa: BLE001
            die(f"upload of {path.name} failed: {exc}")
        res = client.table("media_assets").insert({
            "vault_id": args.vault_id, "uploaded_by": uid, "title": it["title"],
            "media_type": "photo", "storage_path": obj, "mime_type": ct,
            "caption": it.get("caption"), "taken_year": it.get("taken_year"),
        }).execute()
        print(f"  photo  {res.data[0]['id']}  {it['title']!r}  {obj}")
        created += 1
    print(f"\n  created {created}, skipped {skipped}")


if __name__ == "__main__":
    main()
