"""Shared helpers for the LegaSeen AI pipeline.

Rules this module exists to enforce:
  * Secrets come from .env only, and are never printed.
  * The pipeline authenticates as a vault EDITOR with the ANON key, so every
    read and write goes through RLS and the validation triggers. The
    service-role key is never used and never requested.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
VIDEO_BUCKET = "interview-videos"
PHOTO_BUCKET = "archival-photos"


def die(msg: str, code: int = 1) -> "typing.NoReturn":  # noqa: F821
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_env() -> None:
    load_dotenv(REPO_ROOT / ".env")


def require_env(name: str, hint: str = "") -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        suffix = f" ({hint})" if hint else ""
        die(f"{name} is not set in .env{suffix}")
    return val


def editor_client():
    """Return a Supabase client signed in as the pipeline editor.

    Uses the anon key + a password grant, so PostgREST sees a normal
    authenticated user and applies the same RLS policies the app does.
    """
    from supabase import create_client

    url = require_env("SUPABASE_URL")
    anon = require_env("SUPABASE_ANON_KEY", "anon/publishable key, never service-role")
    email = require_env("PIPELINE_EDITOR_EMAIL")
    password = require_env("PIPELINE_EDITOR_PASSWORD")

    if "service_role" in anon:
        die("SUPABASE_ANON_KEY looks like a service-role key. Refusing to run.")

    client = create_client(url, anon)
    try:
        client.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as exc:  # noqa: BLE001
        die(f"could not sign in as {email}: {exc}")

    session = client.auth.get_session()
    if session is None or not session.access_token:
        die(f"sign-in for {email} returned no session")
    print(f"  signed in as {email}")
    return client


def storage_object_path(storage_path: str, bucket: str) -> str:
    """Normalise media_assets.storage_path to a bucket-relative object name.

    Storage RLS derives the vault from the object name via storage_vault_id(),
    which only accepts exactly '{vault_uuid}/{filename}'. If a teammate stored
    the bucket as a prefix, strip it so the signed-URL call still resolves.
    """
    path = storage_path.strip().lstrip("/")
    for prefix in (f"{bucket}/", f"public/{bucket}/"):
        if path.startswith(prefix):
            path = path[len(prefix):]
    return path


def speaker_roles(words: list[dict]) -> dict[str, str]:
    """Map Scribe speaker ids to 'interviewer' / 'subject'.

    With detect_speaker_roles Scribe returns 'agent' (asks questions) and
    'customer' (answers). Older output uses speaker_0/1, in which case the
    speaker with the most words is taken as the subject.
    """
    from collections import Counter

    counts = Counter(
        w["speaker_id"] for w in words
        if w.get("type") == "word" and w.get("speaker_id")
    )
    if not counts:
        return {}
    if set(counts) <= {"agent", "customer"}:
        return {sid: ("subject" if sid == "customer" else "interviewer") for sid in counts}
    subject = counts.most_common(1)[0][0]
    return {sid: ("subject" if sid == subject else "interviewer") for sid in counts}


def speaker_label(role: str, subject_name: str | None) -> str:
    return (subject_name or "Subject") if role == "subject" else "Interviewer"
