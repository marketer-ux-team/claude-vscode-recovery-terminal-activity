#!/usr/bin/env python3
"""Hook für Claude Code (SessionStart, SessionEnd): führt ~/.claude/vscode-sessions.json,
die Liste der in VS-Code-Terminals offenen Claude-Sitzungen.

Nur aktiv, wenn TERM_PROGRAM=vscode. Endet immer mit Exit 0, schreibt nichts auf stdout.
Nur Standardbibliothek.
"""
import fcntl
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

STATE = os.path.expanduser("~/.claude/vscode-sessions.json")
LOCK = STATE + ".lock"
MAX_AGE_DAYS = 14
GRACE_SECONDS = 3


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_entries():
    try:
        with open(STATE, encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("entries", [])
        return [e for e in entries if isinstance(e, dict)]
    except Exception:
        return []


def prune(entries):
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    kept = []
    for e in entries:
        try:
            ts = datetime.fromisoformat(e.get("updated", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts < cutoff:
                continue
        except Exception:
            pass
        kept.append(e)
    return kept


def with_lock(mutate):
    """mutate(entries) -> entries; schreibt gesperrt und atomar."""
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(LOCK, "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            entries = prune(mutate(load_entries()))
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(STATE), prefix=".vscode-sessions.", suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"entries": entries}, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.replace(tmp, STATE)
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def session_id_from(inp):
    tp = inp.get("transcript_path") or ""
    base = os.path.basename(tp)
    if base.endswith(".jsonl") and len(base) > 6:
        return base[:-6]
    return inp.get("session_id") or ""


def ppid_of(pid):
    try:
        out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True, timeout=3).stdout
        return int(out.strip() or 0)
    except Exception:
        return 0


def comm_of(pid):
    try:
        out = subprocess.run(["ps", "-o", "comm=", "-p", str(pid)], capture_output=True, text=True, timeout=3).stdout
        return out.strip()
    except Exception:
        return ""


def find_shell_pid():
    """Elternkette hochlaufen bis zum claude-Prozess, dessen Elternprozess ist die Shell.
    Fallback: Großelternprozess des Hooks."""
    pid = os.getppid()
    for _ in range(8):
        if pid <= 1:
            break
        if "claude" in os.path.basename(comm_of(pid)).lower():
            return ppid_of(pid)
        pid = ppid_of(pid)
    return ppid_of(os.getppid())


def alive(pid):
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False


def on_start(inp):
    sid = session_id_from(inp)
    if not sid:
        return
    cwd = inp.get("cwd") or os.getcwd()
    slot = os.environ.get("CLAUDE_TERM_SLOT") or sid
    name = os.path.basename(cwd.rstrip("/")) or cwd

    def mutate(entries):
        for e in entries:
            if e.get("slot") == slot:
                # Name bleibt: den pflegt die VS-Code-Erweiterung aus dem Tab-Titel.
                e.update({"session_id": sid, "cwd": cwd, "updated": now_iso()})
                e.setdefault("name", name)
                return entries
        entries.append({"slot": slot, "session_id": sid, "cwd": cwd, "name": name, "updated": now_iso()})
        return entries

    with_lock(mutate)


def on_end(inp):
    sid = session_id_from(inp)
    if not sid:
        return
    slot = os.environ.get("CLAUDE_TERM_SLOT") or sid
    shell_pid = find_shell_pid()
    # Abgelöster Hintergrundprozess: wartet, prüft ob die Shell noch lebt, räumt dann auf.
    subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "--finish-end", slot, sid, str(shell_pid)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, close_fds=True,
    )


def finish_end(slot, sid, shell_pid):
    time.sleep(GRACE_SECONDS)
    if not alive(shell_pid):
        return  # Terminal oder VS Code geschlossen: Eintrag behalten

    def mutate(entries):
        return [e for e in entries if not (e.get("slot") == slot and e.get("session_id") == sid)]

    with_lock(mutate)


def main():
    if len(sys.argv) >= 5 and sys.argv[1] == "--finish-end":
        finish_end(sys.argv[2], sys.argv[3], int(sys.argv[4]))
        return
    if os.environ.get("TERM_PROGRAM") != "vscode":
        return
    raw = sys.stdin.read()
    inp = json.loads(raw) if raw.strip() else {}
    if not isinstance(inp, dict):
        return
    ev = inp.get("hook_event_name") or ""
    if ev == "SessionStart":
        on_start(inp)
    elif ev == "SessionEnd":
        on_end(inp)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
