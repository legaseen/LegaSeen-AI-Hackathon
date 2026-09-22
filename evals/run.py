#!/usr/bin/env python
"""
Evaluations and guardrail checks for The Legacy Vault.

    python evals/run.py            # offline suites only (no API calls, no cost)
    python evals/run.py --live     # + the suites that hit the running functions and OpenAI

Writes evals/REPORT.md and exits non-zero if anything that must pass didn't.

Suites
  crisis_regex   the shared crisis filter, 41 phrases                          offline
  guard          the question guardrail, 15 drafts in six languages            offline
  segments       the chapter contract on Ria's real recording                  offline
  crisis_llm     the model-backed crisis check, five languages                 live
  search         17 golden queries, incl. Greek, off-topic and crisis          live
  interview      a scripted 16-turn session; structure checks + an LLM judge    live
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from _common import load_env  # noqa: E402

DENO = os.environ.get("DENO", "/opt/homebrew/bin/deno")
SEARCH_URL = os.environ.get("SEARCH_URL", "http://localhost:8000/")
INTERVIEW_URL = os.environ.get("INTERVIEW_URL", "http://localhost:8001/")
VAULT = "e2daf039-8504-46de-a96a-a9ffb0838b1b"
RIA = "0479c532-8e6f-42e9-a52e-9e651778c94f"


class Suite:
    def __init__(self, name: str, live: bool):
        self.name, self.live = name, live
        self.rows: list[tuple[bool, str]] = []
        self.notes: list[str] = []
        self.metrics: dict[str, str] = {}
        self.seconds = 0.0

    def check(self, ok: bool, label: str) -> None:
        self.rows.append((bool(ok), label))

    @property
    def passed(self) -> int: return sum(1 for ok, _ in self.rows if ok)
    @property
    def failed(self) -> int: return sum(1 for ok, _ in self.rows if not ok)


# ------------------------------------------------------------------ offline
def suite_crisis_regex(s: Suite) -> None:
    r = subprocess.run(["node", str(ROOT / "supabase/functions/_shared/crisis.test.mjs")], capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.strip().startswith("FAIL"): s.check(False, line.strip())
    m = re.search(r"(\d+) patterns, (\d+) cases, (\d+) failure", r.stdout)
    if m:
        s.metrics["cases"] = m.group(2)
        s.check(int(m.group(3)) == 0, f"{m.group(2)} phrases classified correctly")
    else:
        s.check(False, "test did not run: " + (r.stderr or r.stdout)[-200:])


def suite_guard(s: Suite) -> None:
    r = subprocess.run([DENO, "run", str(ROOT / "supabase/functions/_shared/guard.test.ts")], capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith("FAIL"): s.check(False, line)
    m = re.search(r"question guard OK \((\d+) cases\)", r.stdout)
    s.metrics["cases"] = m.group(1) if m else "?"
    s.check(bool(m), "every draft judged as expected" if m else "guard test failed:\n" + r.stdout[-400:])


def suite_segments(s: Suite) -> None:
    ddir = ROOT / "data" / RIA
    segs = json.loads((ddir / "segments.json").read_text())
    doc = json.loads((ddir / "transcript.json").read_text())
    tax = json.loads((ROOT / "scripts/taxonomy.json").read_text())
    words = [w for w in doc["words"] if w.get("type") == "word"]
    text = " ".join(w["text"] for w in words)
    # segment.py floors a chapter's start to the second and ceils its end, so a
    # boundary is "from Scribe" when a word starts within 1s after it / ends within 1s before it.
    starts = sorted(w["start"] for w in words)
    ends = sorted(w["end"] for w in words)
    import bisect
    def from_scribe_start(t: float) -> bool:
        i = bisect.bisect_left(starts, t); return i < len(starts) and starts[i] - t < 1.0
    def from_scribe_end(t: float) -> bool:
        i = bisect.bisect_right(ends, t); return i > 0 and t - ends[i - 1] < 1.0
    s.metrics["chapters"] = str(len(segs))

    s.check(len(segs) >= 4, f"enough chapters for a 20-minute recording ({len(segs)})")
    ordered = sorted(segs, key=lambda x: x["start_seconds"])
    overlaps = sum(1 for a, b in zip(ordered, ordered[1:]) if b["start_seconds"] < a["end_seconds"])
    s.check(overlaps == 0, f"no overlapping chapters ({overlaps})")
    s.check(all(x["end_seconds"] > x["start_seconds"] for x in segs), "every chapter has positive length")
    s.check(all(from_scribe_start(x["start_seconds"]) for x in segs), "every start sits on a Scribe word boundary (not invented by the model)")
    s.check(all(from_scribe_end(x["end_seconds"]) for x in segs), "every end sits on a Scribe word boundary")
    s.check(all(x.get("emotions") for x in segs), "every chapter carries at least one emotion (reachable by search)")
    bad_e = {e for x in segs for e in x["emotions"] if e not in tax["emotions"]}
    s.check(not bad_e, f"emotions come from the closed list {sorted(bad_e) or ''}")
    bad_era = {e for x in segs for e in x.get("era", []) if e not in tax["era"]}
    s.check(not bad_era, f"eras come from the closed list {sorted(bad_era) or ''}")
    s.check(all(4 <= len(x["title"].split()) <= 12 for x in segs), "titles are 4-12 words")
    s.check(all(re.search(r"[A-Za-z]", x["title"]) and all(ord(ch) < 0x0370 for ch in x["title"]) for x in segs), "titles are in English (Latin script)")
    quotes = [x for x in segs if x.get("quote")]
    strip_events = lambda t: re.sub(r"\[[^\]]*\]", " ", t)          # Scribe audio events, e.g. [laughs]
    squash = lambda t: re.sub(r"\W+", " ", strip_events(t)).strip().lower()
    verb = sum(1 for x in quotes if squash(x["quote"]["text"]) in squash(text))
    s.check(verb == len(quotes), f"pull-quotes are verbatim from the transcript ({verb}/{len(quotes)})")
    subj_speakers = {sid for sid, role in doc.get("speaker_roles", {}).items() if role == "subject"} or None
    sub_words = [w for w in words if not subj_speakers or w.get("speaker_id") in subj_speakers]
    covered = sum(1 for w in sub_words if any(x["start_seconds"] <= w["start"] <= x["end_seconds"] for x in segs))
    cov = covered / max(1, len(sub_words))
    s.metrics["coverage"] = f"{cov:.0%}"
    s.check(cov >= 0.85, f"chapters cover the spoken recording ({cov:.0%} of words inside a chapter)")
    s.check(all(not re.search(r"\b(json|segment|utterance)\b", x["title"] + " " + (x.get("summary") or ""), re.I) for x in segs), "no machinery words leak into titles or summaries")


# ------------------------------------------------------------------ live
def _token() -> str:
    from _common import editor_client
    return editor_client().auth.get_session().access_token


def suite_crisis_llm(s: Suite) -> None:
    r = subprocess.run([DENO, "run", "--allow-net", "--allow-env", f"--env-file={ROOT / '.env'}",
                        str(ROOT / "supabase/functions/_shared/crisis.llm.test.ts")], capture_output=True, text=True, cwd=ROOT)
    for line in r.stdout.splitlines():
        if line.startswith("FAIL"): s.check(False, line)
    m = re.search(r"llm crisis check OK \((\d+) cases\)", r.stdout)
    s.metrics["cases"] = m.group(1) if m else "?"
    s.check(bool(m), "every phrase judged as expected" if m else "llm crisis test failed:\n" + (r.stdout + r.stderr)[-400:])


def suite_search(s: Suite, tok: str) -> None:
    import httpx
    g = json.loads((ROOT / "evals/search_golden.json").read_text())
    H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    hits = crisis_ok = none_ok = 0
    n_hit = n_crisis = n_none = 0
    for c in g["cases"]:
        d = httpx.post(SEARCH_URL, headers=H, json={"vault_id": VAULT, "media_id": g["media_id"], "query": c["query"]}, timeout=90).json()
        title = (d.get("segment") or {}).get("title")
        if c["expect"] == "crisis":
            n_crisis += 1; ok = d.get("crisis") is True and d.get("segment") is None
            crisis_ok += ok; s.check(ok, f"crisis: {c['query']!r} -> {'blocked' if ok else 'NOT BLOCKED: ' + str(title)}")
        elif c["expect"] is None:
            n_none += 1; ok = not d.get("found") and not d.get("crisis")
            none_ok += ok; s.check(ok, f"off-topic: {c['query']!r} -> {'nothing' if ok else 'wrongly returned ' + str(title)}")
        else:
            n_hit += 1; ok = bool(title) and c["expect"].lower() in title.lower()
            hits += ok; s.check(ok, f"{c['query']!r} -> {title!r}" + ("" if ok else f"  (wanted …{c['expect']}…)"))
    s.metrics["relevance"] = f"{hits}/{n_hit}"
    s.metrics["crisis blocked"] = f"{crisis_ok}/{n_crisis}"
    s.metrics["off-topic refused"] = f"{none_ok}/{n_none}"


def suite_interview(s: Suite, tok: str) -> None:
    import httpx
    from openai import OpenAI
    p = json.loads((ROOT / "evals/interview_persona.json").read_text())
    H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    hist: list[dict] = []; skipped: list[str] = []; turns: list[dict] = []
    guard_retries = guard_fallbacks = 0
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    persona_model = os.environ.get("OPENAI_SEARCH_MODEL", "gpt-4.1-mini")

    def call() -> dict:
        d = httpx.post(INTERVIEW_URL, headers=H, timeout=180,
                       json={"vault_id": VAULT, "history": hist, "skipped": skipped, "language": p["language"], "silent": True}).json()
        assert "error" not in d, d
        return d

    def answer(question: str, phase: str, n_in_phase: int) -> str:
        """The simulated elder. Scripted behaviours fire by part; otherwise she answers in character from her fact sheet."""
        beh = p["behaviours"].get(phase)
        if beh and n_in_phase < len(beh) and beh[n_in_phase]: return beh[n_in_phase]
        r = client.chat.completions.create(model=persona_model, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": p["persona_prompt"]},
                      {"role": "user", "content": f"The interviewer asks: {question}\nAnswer in JSON {{\"answer\": \"...\"}}."}])
        return json.loads(r.choices[0].message.content).get("answer", "").strip() or "Mm."

    d = call()
    s.check(bool(d.get("intro")) and "Ria" in d["intro"], "session opens with a personalised welcome")
    s.check(d["phase"]["index"] == 0 and "?" in d["question"], "first question is the slate (name, where and when born)")
    hist.append({"question": d["question"], "answer": "", "phase": d["phase"]["id"]})
    last_phase = 0
    for i in range(p["max_turns"]):
        pid = hist[-1]["phase"]
        n_in = sum(1 for t in hist if t["phase"] == pid) - 1
        hist[-1]["answer"] = answer(hist[-1]["question"], pid, n_in)
        d = call()
        if d.get("skipped"): skipped[:] = d["skipped"]
        if d.get("done"):
            s.check(True, f"session closed with a farewell after {i + 1} answers"); break
        q = d["question"]; ph = d["phase"]
        g = d.get("guard") or {}
        guard_retries += g.get("retried", False); guard_fallbacks += g.get("fallback", False)
        turns.append({"phase": ph["id"], "prev_answer": hist[-1]["answer"], "bridge": d.get("bridge"), "question": q})
        # structure checks on every question
        s.check(q.count("?") <= 1, f"one question only: {q[:70]!r}")
        s.check(len(q.split()) <= 30, f"under 30 words ({len(q.split())}): {q[:60]!r}")
        s.check(not re.match(r"^(do|did|does|is|are|was|were|have|has|had|can|could|would|will|should)\b", q, re.I), f"open, not yes/no: {q[:60]!r}")
        s.check(all(q.lower() != t["question"].lower() for t in hist), f"not a repeat: {q[:60]!r}")
        s.check(ph["index"] >= last_phase, f"parts move forward ({last_phase}->{ph['index']})")
        if ph["index"] > last_phase:
            s.check(bool(d.get("bridge")), f"new part '{ph['title']}' opens with a bridge")
        # the refusal in 'youth' must end that part
        if hist[-1]["phase"] == "youth" and "rather not" in hist[-1]["answer"]:
            s.check(ph["id"] != "youth", f"refusal ends the part (moved to '{ph['title']}')")
        last_phase = ph["index"]
        hist.append({"question": q, "answer": "", "phase": ph["id"]})
    s.check(last_phase >= 4, f"reached part {last_phase + 1} of 10 in {len(turns)} questions")
    s.metrics["questions"] = str(len(turns))
    s.metrics["guard retries"] = str(guard_retries); s.metrics["guard fallbacks"] = str(guard_fallbacks)

    # an LLM judge on question quality — a second model, JSON mode, no temperature
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    rubric = ("You grade ONE interview question asked to an elder recording her life story, given the answer she had just given. "
              "Score 1-5 on each: builds_on (uses her actual words/details), concrete (asks for a specific scene, not an abstraction), "
              "warm (sounds like a kind person speaking, not a form). Return JSON {\"builds_on\":n,\"concrete\":n,\"warm\":n}.")
    tot = {"builds_on": 0, "concrete": 0, "warm": 0}; judged = 0
    for t in turns:
        if not t["prev_answer"] or "rather not" in t["prev_answer"]: continue
        r = client.chat.completions.create(model=os.environ.get("OPENAI_SEGMENT_MODEL", "gpt-4.1"), response_format={"type": "json_object"},
            messages=[{"role": "system", "content": rubric},
                      {"role": "user", "content": f"Her last answer: {t['prev_answer']}\nThe next question asked: {(t['bridge'] or '') + ' ' + t['question']}"}])
        sc = json.loads(r.choices[0].message.content); judged += 1
        for k in tot: tot[k] += int(sc.get(k, 0))
    if judged:
        means = {k: v / judged for k, v in tot.items()}
        s.metrics["judge builds_on"] = f"{means['builds_on']:.1f}/5"; s.metrics["judge concrete"] = f"{means['concrete']:.1f}/5"; s.metrics["judge warm"] = f"{means['warm']:.1f}/5"
        s.check(means["builds_on"] >= 3.5, f"questions build on what she said (judge {means['builds_on']:.1f}/5 over {judged})")
        s.check(means["warm"] >= 4.0, f"questions sound like a person (judge {means['warm']:.1f}/5)")
    s.notes = [f"  {t['phase']:10} A: {t['prev_answer'][:48]:48} -> Q: {(t['bridge'] + ' ' if t['bridge'] else '')}{t['question']}" for t in turns]


# ------------------------------------------------------------------ report
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="also run suites that call the functions and OpenAI")
    ap.add_argument("--only", help="comma-separated suite names")
    args = ap.parse_args()
    load_env()

    plan = [("crisis_regex", False, suite_crisis_regex), ("guard", False, suite_guard), ("segments", False, suite_segments),
            ("crisis_llm", True, suite_crisis_llm), ("search", True, suite_search), ("interview", True, suite_interview)]
    only = set(args.only.split(",")) if args.only else None
    tok = _token() if args.live else ""
    suites: list[Suite] = []
    for name, live, fn in plan:
        if only and name not in only: continue
        if live and not args.live: continue
        s = Suite(name, live); t0 = time.time()
        try:
            fn(s, tok) if live and name != "crisis_llm" else fn(s)
        except Exception as exc:  # noqa: BLE001
            s.check(False, f"suite crashed: {exc}")
        s.seconds = time.time() - t0
        suites.append(s)
        print(f"{name:14} {'PASS' if s.failed == 0 else 'FAIL':4}  {s.passed} passed, {s.failed} failed  ({s.seconds:.0f}s)  {s.metrics}")
        for ok, label in s.rows:
            if not ok: print(f"    FAIL  {label}")

    lines = [f"# Evaluation report", f"", f"Run {datetime.now(timezone.utc).isoformat(timespec='minutes')} · `python evals/run.py{' --live' if args.live else ''}`", "",
             "| Suite | Result | Checks | Metrics | Time |", "|---|---|---|---|---|"]
    for s in suites:
        met = ", ".join(f"{k} {v}" for k, v in s.metrics.items())
        lines.append(f"| {s.name} | {'✅ pass' if s.failed == 0 else '❌ fail'} | {s.passed}/{len(s.rows)} | {met} | {s.seconds:.0f}s |")
    for s in suites:
        fails = [l for ok, l in s.rows if not ok]
        if fails:
            lines += ["", f"## {s.name} — failures", ""] + [f"- {l}" for l in fails]
        if s.notes:
            lines += ["", f"## {s.name} — transcript", "", "```"] + s.notes + ["```"]
    (ROOT / "evals/REPORT.md").write_text("\n".join(lines) + "\n")
    print(f"\nreport: evals/REPORT.md")
    if any(s.failed for s in suites): sys.exit(1)


if __name__ == "__main__":
    main()
