#!/usr/bin/env python3
"""Show what the pipeline editor account can actually see through RLS.

Run this first. It confirms the credentials work and prints the vault_id and
media_id values the other scripts need — no dashboard hunting required.

    python scripts/whoami.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import VIDEO_BUCKET, editor_client, load_env, storage_object_path  # noqa: E402


def main() -> None:
    load_env()
    client = editor_client()

    user = client.auth.get_user()
    uid = user.user.id if user and user.user else None
    print(f"  user_id: {uid}\n")

    vaults = (client.table("vaults")
              .select("id,name,subject_name,owner_id").execute().data or [])
    if not vaults:
        print("  No vaults visible. This account is not an owner or member of any vault.")
        print("  A vault OWNER must add it to vault_members with role='editor'.")
        return

    members = (client.table("vault_members")
               .select("vault_id,user_id,role").execute().data or [])
    role_by_vault = {m["vault_id"]: m["role"] for m in members if m["user_id"] == uid}

    media = (client.table("media_assets")
             .select("id,vault_id,title,media_type,storage_path,duration_seconds")
             .execute().data or [])
    segs = (client.table("story_segments")
            .select("id,source_media_id").execute().data or [])
    seg_counts: dict[str, int] = {}
    for s in segs:
        seg_counts[s["source_media_id"]] = seg_counts.get(s["source_media_id"], 0) + 1

    for v in vaults:
        role = "owner" if v["owner_id"] == uid else role_by_vault.get(v["id"], "viewer?")
        can_write = role in ("owner", "editor")
        print(f"  VAULT  {v['id']}")
        print(f"         {v['name']!r} — subject {v['subject_name']!r}")
        print(f"         your role: {role}  {'(can write segments)' if can_write else '(CANNOT write segments)'}")

        vm = [m for m in media if m["vault_id"] == v["id"]]
        if not vm:
            print("         no media assets\n")
            continue
        for m in vm:
            n = seg_counts.get(m["id"], 0)
            flag = "" if m["media_type"] in ("video", "audio") else "   <- photo, not segmentable"
            print(f"           {m['media_type']:<5} {m['id']}  {m['title'][:34]!r}{flag}")
            print(f"                 path={VIDEO_BUCKET}/{storage_object_path(m['storage_path'], VIDEO_BUCKET)}")
            print(f"                 existing story_segments: {n}")
        print()

    segmentable = [m for m in media if m["media_type"] in ("video", "audio")]
    if segmentable:
        m = segmentable[0]
        print("  Next:")
        print(f"    .venv/bin/python scripts/transcribe.py --media-id {m['id']}")
        print(f"    .venv/bin/python scripts/segment.py --media-id {m['id']}")


if __name__ == "__main__":
    main()
