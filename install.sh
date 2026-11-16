#!/usr/bin/env bash
# Installiert Hooks, Claude-Code-Einstellungen, VS-Code-Einstellungen und die Erweiterung.
# Bestehende Einträge bleiben erhalten; vor jeder Änderung entsteht eine Sicherungskopie (.bak-<datum>).
# Aufruf: bash install.sh            (macOS/Linux, braucht python3, node/npm, VS-Code-CLI "code")
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M)"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"

case "$(uname -s)" in
  Darwin) VSCODE_SETTINGS="$HOME/Library/Application Support/Code/User/settings.json" ;;
  Linux)  VSCODE_SETTINGS="$HOME/.config/Code/User/settings.json" ;;
  *) echo "Nur macOS und Linux. Unter Windows schreiben Hooks nicht auf das Terminal-Gerät."; exit 1 ;;
esac

for cmd in python3 node npm code; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Fehlt im PATH: $cmd"; exit 1; }
done

echo "1/4 Hooks nach $HOOKS_DIR"
mkdir -p "$HOOKS_DIR"
for f in tab-status.sh vscode-sessions.py; do
  [ -f "$HOOKS_DIR/$f" ] && cp "$HOOKS_DIR/$f" "$HOOKS_DIR/$f.bak-$STAMP"
  cp "$HERE/hooks/$f" "$HOOKS_DIR/$f"
  chmod +x "$HOOKS_DIR/$f"
done

echo "2/4 Claude-Code-Einstellungen ($CLAUDE_DIR/settings.json)"
[ -f "$CLAUDE_DIR/settings.json" ] && cp "$CLAUDE_DIR/settings.json" "$CLAUDE_DIR/settings.json.bak-$STAMP"
python3 - "$CLAUDE_DIR/settings.json" "$HERE/settings/claude-settings.snippet.json" <<'EOF'
import json, os, sys
target, snippet = sys.argv[1], sys.argv[2]
d = json.load(open(target)) if os.path.exists(target) else {}
s = json.load(open(snippet))
d.setdefault("env", {}).update(s.get("env", {}))
hooks = d.setdefault("hooks", {})
for event, groups in s.get("hooks", {}).items():
    lst = hooks.setdefault(event, [])
    present = {h.get("command") for g in lst for h in g.get("hooks", [])}
    for g in groups:
        cmds = [h.get("command") for h in g.get("hooks", [])]
        if all(c in present for c in cmds):
            print(f"  schon da: {event}: {cmds[0]}")
            continue
        lst.append(g)
        print(f"  ergänzt:  {event}: {cmds[0]}")
with open(target, "w") as f:
    json.dump(d, f, indent=2, ensure_ascii=False); f.write("\n")
EOF

echo "3/4 VS-Code-Einstellungen ($VSCODE_SETTINGS)"
mkdir -p "$(dirname "$VSCODE_SETTINGS")"
[ -f "$VSCODE_SETTINGS" ] && cp "$VSCODE_SETTINGS" "$VSCODE_SETTINGS.bak-$STAMP"
python3 - "$VSCODE_SETTINGS" "$HERE/settings/vscode-settings.snippet.json" <<'EOF'
import json, os, re, sys
target, snippet = sys.argv[1], sys.argv[2]
raw = open(target).read() if os.path.exists(target) else "{}"
# JSONC: Zeilen- und Blockkommentare sowie Komma vor schließender Klammer entfernen
stripped = re.sub(r"//[^\n]*", "", raw)
stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.S)
stripped = re.sub(r",(\s*[}\]])", r"\1", stripped)
try:
    d = json.loads(stripped)
except Exception as e:
    print(f"  settings.json nicht lesbar ({e}). Bitte diese Schlüssel von Hand eintragen:")
    print(open(snippet).read()); sys.exit(0)
if stripped.strip() != raw.strip():
    print("  Hinweis: Datei enthielt Kommentare, sie werden beim Schreiben entfernt.")
s = json.load(open(snippet))
for k, v in s.items():
    old = d.get(k, "<nicht gesetzt>")
    if old != v:
        print(f"  {k}: {old!r} -> {v!r}")
    d[k] = v
with open(target, "w") as f:
    json.dump(d, f, indent=4, ensure_ascii=False); f.write("\n")
EOF

echo "4/4 Erweiterung bauen und installieren"
VSIX="$(ls "$HERE"/extension/*.vsix 2>/dev/null | head -1 || true)"
if [ -z "$VSIX" ]; then
  (cd "$HERE/extension" && yes | npx --yes vsce package --allow-missing-repository >/dev/null)
  VSIX="$(ls "$HERE"/extension/*.vsix | head -1)"
fi
code --install-extension "$VSIX" --force >/dev/null
code --list-extensions | grep -q claude-terminal-restore && echo "  installiert: local.claude-terminal-restore"

cat <<'EOF'

Fertig. Nächste Schritte:
  1. VS Code komplett beenden und neu starten (Hooks und Erweiterung werden beim Start geladen).
  2. Terminal öffnen, "claude" starten: Tab zeigt "⚪ bereit · <Name>".
  3. Terminal benennen: Cmd+Shift+P -> "Claude: Terminal benennen" (nicht das normale Umbenennen).
Laufende Claude-Sitzungen übernehmen die Hooks erst nach einem Neustart der Sitzung.
EOF
