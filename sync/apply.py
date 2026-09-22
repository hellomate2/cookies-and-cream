#!/usr/bin/env python3
"""Apply a JSON patch to data/tracker.json, then rebuild the encrypted bundle.

Used by the every-5-minutes listserv watcher. Deterministic and idempotent:
re-applying the same patch does not create duplicates.

    python3 sync/apply.py patch.json [--push]

Patch shape (every key optional):
{
  "tasks_add":      [ <task object, same shape as tracker.json tasks> ],
  "tasks_update":   [ {"match": "<substring of what>", "status": "accepted",
                       "status_evidence": "...", "due": "...", "notes": "..."} ],
  "rules_add":      [ <rule object> ],
  "bans_add":       [ {"name": "Dev", "from": "ISO", "until": "ISO",
                       "by": "Full Name", "reason": "..."} ],
  "bans_clear":     [ "Dev" ],
  "punishments_add":[ {"name": "Paul", "text": "..."} ],
  "heat":           [ {"name": "Paul", "text": "..."} ],
  "praise":         [ {"name": "Dev",  "text": "..."} ],
  "events_add":     [ <event object> ],
  "threads_upsert": [ <thread object with id> ],
  "away_set":       [ {"who": "Dev", "from": "ISO", "until": "ISO", "what": "in New York"} ],
  "seen_message_id": "1a0c...",
  "seen_at": "ISO"
}
"""
import json, os, re, subprocess, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKER = os.path.join(ROOT, "data", "tracker.json")
STATE = os.path.join(ROOT, "sync", "state.json")

def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

def load(p, default):
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def find_task(tasks, needle):
    n = norm(needle)
    if not n:
        return None
    for t in tasks:
        if t.get("id") == needle:
            return t
    for t in tasks:
        if n in norm(t.get("what")):
            return t
    return None

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    patch = load(sys.argv[1], {})
    d = load(TRACKER, None)
    if d is None:
        sys.exit("tracker.json missing; run the merge first")

    changed = []

    tasks = d.setdefault("tasks", [])
    for t in patch.get("tasks_add", []):
        if find_task(tasks, t.get("id") or "") or any(
            norm(t.get("what"))[:60] == norm(x.get("what"))[:60]
            and (t.get("assigned_by") or "") == (x.get("assigned_by") or "")
            for x in tasks
        ):
            continue
        t.setdefault("status", "open")
        t.setdefault("priority", "normal")
        tasks.append(t)
        changed.append("new task: " + (t.get("what") or "")[:60])

    for u in patch.get("tasks_update", []):
        t = find_task(tasks, u.get("match") or u.get("id") or "")
        if not t:
            changed.append("NO MATCH for update: " + str(u.get("match"))[:50])
            continue
        for k, v in u.items():
            if k in ("match", "id"):
                continue
            if v is not None and t.get(k) != v:
                t[k] = v
                changed.append(f"{t['what'][:40]} · {k} -> {str(v)[:40]}")

    rules = d.setdefault("rules", [])
    have = {norm(r.get("rule"))[:80] for r in rules}
    for r in patch.get("rules_add", []):
        k = norm(r.get("rule"))[:80]
        if k and k not in have:
            have.add(k)
            rules.append(r)
            changed.append("new rule: " + (r.get("rule") or "")[:60])

    ps = {p["name"]: p for p in d.setdefault("pledge_status", [])}
    for name in patch.get("bans_clear", []):
        if name in ps:
            ps[name]["bans"] = []
            changed.append(f"{name}: bans cleared")
    for b in patch.get("bans_add", []):
        p = ps.get(b.get("name"))
        if not p:
            continue
        rec = {k: b.get(k) for k in ("from", "until", "by", "reason")}
        if not any(x.get("until") == rec["until"] and x.get("by") == rec["by"] for x in p["bans"]):
            p["bans"].append(rec)
            changed.append(f"{b['name']}: banned until {rec['until']} by {rec['by']}")
    for item in patch.get("punishments_add", []):
        p = ps.get(item.get("name"))
        if not p:
            continue
        txt = item.get("text", "")
        if norm(txt)[:50] not in [norm(x)[:50] for x in p["running_punishments"]]:
            p["running_punishments"].append(txt)
            changed.append(f"{item['name']}: punishment {txt[:50]}")
    for fld in ("heat", "praise"):
        for item in patch.get(fld, []):
            p = ps.get(item.get("name"))
            if not p:
                continue
            txt = item.get("text", "")
            if txt and norm(txt)[:40] not in norm(p.get(fld, "")):
                p[fld] = (p.get(fld, "") + " " + txt).strip()
                changed.append(f"{item['name']}: {fld} updated")

    events = d.setdefault("events", [])
    seen_ev = {(norm(e.get("what"))[:60], e.get("when") or "") for e in events}
    for e in patch.get("events_add", []):
        k = (norm(e.get("what"))[:60], e.get("when") or "")
        if k not in seen_ev:
            seen_ev.add(k)
            events.append(e)
            changed.append("new event: " + (e.get("what") or "")[:50])

    threads = d.setdefault("threads", [])
    by_id = {t.get("id"): t for t in threads}
    for th in patch.get("threads_upsert", []):
        if th.get("id") in by_id:
            by_id[th["id"]].update(th)
        else:
            threads.append(th)
            changed.append("new thread: " + (th.get("subject") or "")[:50])

    if "away_set" in patch:
        d["away"] = patch["away_set"]
        changed.append("away list updated")

    with open(TRACKER, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)

    st = load(STATE, {})
    if patch.get("seen_message_id"):
        st["seen_message_id"] = patch["seen_message_id"]
    st["seen_at"] = patch.get("seen_at") or datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    st["last_changes"] = changed[-20:]
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=1)

    if changed:
        print(f"{len(changed)} change(s):")
        for c in changed:
            print("  ·", c)
    else:
        print("no changes")

    args = [sys.executable, os.path.join(ROOT, "sync", "build.py")]
    if "--push" in sys.argv:
        args.append("--push")
    subprocess.run(args, check=True)

if __name__ == "__main__":
    main()
