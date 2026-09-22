#!/usr/bin/env python
"""
Translate a transcript's utterances into English, for the family.

    python scripts/translate.py --media-id <uuid>          # writes data/<id>/translation.en.json
    python scripts/translate.py --media-id <uuid> --force  # even if the recording is in English

Runs after transcribe.py. The original transcript is never altered: this writes
a parallel file keyed by utterance number, which publish.py folds into the
sidecar as `translations.en` and into `{media_id}.en.vtt`. Names of people and
places are kept as spoken.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT, die, load_env, require_env  # noqa: E402
from segment import build_utterances  # noqa: E402

BATCH = 40          # utterances per request; keeps each JSON reply small and exact

TWO = {"eng": "en", "en": "en"}

SYSTEM = """You translate an oral-history interview into English for the speaker's family.
You get numbered utterances in the original language. Return JSON of the form
{"translations": {"<n>": "<English>", ...}} with EVERY number present.
Translate faithfully and naturally, keeping the speaker's voice — plain, spoken
English, not literary. Keep names of people and places as they are. Keep
hesitations only where they carry meaning. Never summarise, never add."""


def translate_batch(client, model: str, items: list[dict], language: str) -> dict[str, str]:
    lines = "\n".join(f"[{u['n']}] {u['text']}" for u in items)
    resp = client.chat.completions.create(
        model=model, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"Source language: {language}\n\n{lines}"}])
    data = json.loads(resp.choices[0].message.content)
    out = data.get("translations") or {}
    missing = [u["n"] for u in items if str(u["n"]) not in out]
    if missing:
        die(f"model skipped utterances {missing[:8]}{'...' if len(missing) > 8 else ''}")
    return {str(k): str(v) for k, v in out.items()}


def main() -> None:
    ap = argparse.ArgumentParser(description="Translate a transcript into English for the family.")
    ap.add_argument("--media-id", required=True)
    ap.add_argument("--force", action="store_true", help="translate even an English recording")
    args = ap.parse_args()

    load_env()
    ddir = REPO_ROOT / "data" / args.media_id
    tpath = ddir / "transcript.json"
    if not tpath.exists():
        die(f"{tpath} not found — run transcribe.py first")
    doc = json.loads(tpath.read_text())
    language = (doc.get("language_code") or "").lower()
    if TWO.get(language, language[:2]) == "en" and not args.force:
        print(f"  language: {language} — nothing to translate")
        return

    utterances = build_utterances(doc.get("words") or [])
    if not utterances:
        die("transcript has no utterances")

    from openai import OpenAI
    client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    model = os.environ.get("OPENAI_SEGMENT_MODEL", "gpt-4.1").strip() or "gpt-4.1"
    print(f"  language: {language} -> en  ({len(utterances)} utterances, model={model})")

    out: dict[str, str] = {}
    for i in range(0, len(utterances), BATCH):
        chunk = utterances[i:i + BATCH]
        out.update(translate_batch(client, model, chunk, language))
        print(f"  translated {min(i + BATCH, len(utterances))}/{len(utterances)}")

    result = {"media_id": args.media_id, "source_language": language, "target": "en",
              "model": model, "utterances": out}
    (ddir / "translation.en.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"  written : data/{args.media_id}/translation.en.json")


if __name__ == "__main__":
    main()
