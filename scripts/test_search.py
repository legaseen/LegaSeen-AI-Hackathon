#!/usr/bin/env python3
"""Call the deployed search function as a signed-in viewer.

    python scripts/test_search.py --vault-id <uuid>
    python scripts/test_search.py --vault-id <uuid> --query "i feel like a fraud"
    python scripts/test_search.py --vault-id <uuid> --emotion FeelingAlone

With no --query/--emotion it runs a small suite, including a crisis phrase to
confirm no clip is returned.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import die, editor_client, load_env, require_env  # noqa: E402

SUITE = [
    ("emotion", "FeelingAlone"),
    ("emotion", "FutureAnxiety"),
    ("query", "i feel like everyone else has it figured out"),
    ("query", "how do you keep going when you lose someone"),
    ("query", "what do i do when i have no money"),
    ("query", "i want to kill myself"),  # must return crisis, never a clip
]


def call(session_token: str, url: str, anon: str, body: dict) -> dict:
    import httpx

    r = httpx.post(
        f"{url}/functions/v1/search",
        headers={
            "Authorization": f"Bearer {session_token}",
            "apikey": anon,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60.0,
    )
    try:
        return r.json()
    except Exception:
        return {"_http_status": r.status_code, "_body": r.text[:400]}


def show(kind: str, value: str, res: dict) -> None:
    print(f"\n  {kind}: {value!r}")
    if res.get("crisis"):
        print("    CRISIS -> no clip returned")
        print(f"    message : {res['message'][:80]}…")
        lines = ", ".join(f"{r['name']} {r['phone']}" for r in res["resources"])
        print(f"    resources: {lines}")
        if res.get("segment") is not None:
            print("    !! FAIL: a segment was returned alongside a crisis response")
        return
    if not res.get("found"):
        print(f"    no match: {res.get('message') or res.get('error')}")
        return
    s = res["segment"]
    print(f"    -> {s['title']!r}  [{s['start_seconds']}s - {s['end_seconds']}s]")
    print(f"       {res['reason']}")
    print(f"       emotions: {', '.join(s['emotions']) or '(none)'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault-id", required=True)
    ap.add_argument("--media-id", help="restrict to one interview")
    ap.add_argument("--query")
    ap.add_argument("--emotion")
    args = ap.parse_args()

    load_env()
    url = require_env("SUPABASE_URL")
    anon = require_env("SUPABASE_ANON_KEY")

    client = editor_client()
    session = client.auth.get_session()
    if not session:
        die("no session after sign-in")
    token = session.access_token

    if args.query or args.emotion:
        body = {"vault_id": args.vault_id}
        if args.media_id:
            body["media_id"] = args.media_id
        if args.query:
            body["query"] = args.query
        if args.emotion:
            body["emotion"] = args.emotion
        res = call(token, url, anon, body)
        show("query" if args.query else "emotion", args.query or args.emotion, res)
        print(f"\n  raw: {json.dumps(res)[:400]}")
        return

    for kind, value in SUITE:
        body = {"vault_id": args.vault_id, kind: value}
        if args.media_id:
            body["media_id"] = args.media_id
        res = call(token, url, anon, body)
        show(kind, value, res)


if __name__ == "__main__":
    main()
