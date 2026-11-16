#!/usr/bin/env bash
# Setzt den Terminal-Titel je nach Claude-Code-Zustand.
# Aufruf: tab-status.sh idle|running|waiting|done
# Hooks laufen ohne Controlling-Terminal (/dev/tty: "Device not configured"), deshalb wird das
# Terminal-Gerät der Shell ermittelt, in der Claude läuft (Prozesskette Hook -> claude -> Shell),
# und direkt dorthin geschrieben.
# Name: CLAUDE_TERM_NAME (von der Erweiterung beim Wiederherstellen gesetzt), sonst der in
# ~/.claude/vscode-sessions.json gespeicherte Name dieser Sitzung, sonst der Ordnername.
input="$(cat)"   # Hook-Eingabe (JSON)

bell=""
case "$1" in
  idle)    t="⚪ bereit" ;;
  running) t="🔵 läuft" ;;
  waiting) t="🟡 wartet auf dich"; bell=1 ;;
  done)    t="🟢 fertig"; bell=1 ;;
  *)       exit 0 ;;
esac

# Terminal-Gerät finden
dev=""
p=$PPID
for _ in 1 2 3 4 5 6 7 8; do
  [ -z "$p" ] || [ "$p" -le 1 ] && break
  c="$(ps -o comm= -p "$p" 2>/dev/null)"
  case "$c" in
    *claude)
      shell="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
      tty="$(ps -o tty= -p "$shell" 2>/dev/null | tr -d ' ')"
      [ -n "$tty" ] && [ "$tty" != "??" ] && dev="/dev/$tty"
      break
      ;;
  esac
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
done
[ -z "$dev" ] && dev=/dev/tty

# Zustand je Sitzung merken (für die Erweiterung) und gespeicherten Namen holen
stored="$(printf '%s' "$input" | python3 -c '
import json, os, sys
state_word = sys.argv[1]
try:
    inp = json.load(sys.stdin)
    tp = inp.get("transcript_path") or ""
    sid = os.path.basename(tp)[:-6] if tp.endswith(".jsonl") else inp.get("session_id", "")
    if sid:
        d = os.path.expanduser("~/.claude/tab-status"); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, sid), "w").write(state_word)
    state = json.load(open(os.path.expanduser("~/.claude/vscode-sessions.json")))
    for e in state.get("entries", []):
        if e.get("session_id") == sid and e.get("name"):
            print(e["name"]); break
except Exception:
    pass
' "$1" 2>/dev/null)"
name="$stored"
[ -z "$name" ] && name="$CLAUDE_TERM_NAME"
[ -z "$name" ] && name="$(basename "$PWD")"

{
  printf '\033]0;%s · %s\007' "$t" "$name"
  [ -n "$bell" ] && printf '\a'
} 2>/dev/null > "$dev"

exit 0   # Hook darf Claude Code nie blockieren
