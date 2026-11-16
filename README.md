<p align="center">
  <a href="https://www.marketer-ux.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/marketer-ux-logo-white.svg">
      <img src="assets/marketer-ux-logo.svg" alt="marketer UX" width="220">
    </picture>
  </a>
</p>

# Claude VS Code Recovery + Terminal Activity

Zwei Ergänzungen für Claude Code in VS Code auf macOS und Linux:

1. **Recovery:** Nach dem Schließen und Neustart von VS Code kommen alle Terminals zurück, in denen eine Claude-Code-Sitzung lief. Gleicher Ordner, gleiche Reihenfolge, gleicher Name, und in jedem startet automatisch `claude --resume <Session-ID>`.
2. **Terminal Activity:** Jeder Terminal-Tab zeigt den Zustand der Claude-Sitzung im Titel, mit Glocke, wenn Claude etwas von dir braucht.

| Zustand | Tab-Titel | Glocke |
|---|---|---|
| Sitzung gestartet | ⚪ bereit · Name | – |
| Claude arbeitet | 🔵 läuft · Name | – |
| Claude braucht Eingabe oder Freigabe | 🟡 wartet auf dich · Name | ja |
| Durchlauf fertig | 🟢 fertig · Name | ja |

English summary: restores every VS Code terminal that ran a Claude Code session after a full restart (same folder, order and name, with `claude --resume`), and shows the session state in the terminal tab title with a bell when Claude is waiting for you. German instructions below.

Ein Werkzeug von [marketer UX](https://www.marketer-ux.com), entstanden im eigenen Arbeitsalltag mit zwanzig und mehr parallelen Claude-Sitzungen. MIT-Lizenz.

---

## Inhalt

- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Benutzung](#benutzung)
- [Wie es funktioniert](#wie-es-funktioniert)
- [Dateien](#dateien)
- [Einschränkungen](#einschränkungen)
- [Fehlersuche](#fehlersuche)
- [Deinstallation](#deinstallation)

## Voraussetzungen

- macOS oder Linux. Unter Windows funktioniert die Titel-Variante nicht, weil Hooks dort nicht auf das Terminal-Gerät schreiben können.
- VS Code 1.140 oder neuer mit der CLI `code` im PATH.
- Claude Code als CLI (`claude`), gestartet im integrierten Terminal von VS Code.
- `python3`, `node` und `npm` (npm nur zum Bauen der Erweiterung, falls keine fertige `.vsix` genutzt wird).

## Installation

### Schnell: Installer

```bash
git clone https://github.com/marketer-ux-team/claude-vscode-recovery-terminal-activity.git
cd claude-vscode-recovery-terminal-activity
bash install.sh
```

Der Installer

- kopiert die zwei Hooks nach `~/.claude/hooks/`,
- hängt die Hook-Einträge und eine Umgebungsvariable an `~/.claude/settings.json` an (bestehende Einträge bleiben),
- setzt drei Schlüssel in der VS-Code-`settings.json`,
- baut und installiert die Erweiterung.

Vor jeder Änderung an einer bestehenden Datei legt er eine Kopie `<datei>.bak-<datum>` daneben.

Die fertige Erweiterung liegt auch als `.vsix` bei den [Releases](https://github.com/marketer-ux-team/claude-vscode-recovery-terminal-activity/releases). Liegt eine `.vsix` im Ordner `extension/`, nutzt der Installer sie, statt neu zu bauen.

Danach VS Code komplett beenden und neu starten.

### Von Hand

1. `hooks/tab-status.sh` und `hooks/vscode-sessions.py` nach `~/.claude/hooks/` kopieren und ausführbar machen.
2. Inhalt von `settings/claude-settings.snippet.json` in `~/.claude/settings.json` einarbeiten. Die Hook-Listen werden angehängt, nicht ersetzt. `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` unter `env` verhindert, dass Claude Code den Titel selbst wieder überschreibt.
3. Inhalt von `settings/vscode-settings.snippet.json` in die VS-Code-`settings.json` übernehmen (macOS: `~/Library/Application Support/Code/User/settings.json`, Linux: `~/.config/Code/User/settings.json`).
4. Erweiterung installieren: `.vsix` aus den Releases laden und `code --install-extension claude-terminal-restore-<version>.vsix`. Oder selbst bauen: `cd extension && yes | npx --yes vsce package --allow-missing-repository`.
5. VS Code komplett beenden und neu starten.

## Benutzung

**Terminal benennen:** `Cmd+Shift+P` → „Claude: Terminal benennen“. Der Name wird gespeichert und sofort im Titel gezeigt, zum Beispiel „🔵 läuft · Kundenprojekt Relaunch“. Ohne eigenen Namen steht der automatische Sitzungsname von Claude oder der Ordnername im Titel.

Das normale Umbenennen von VS Code (Rechtsklick → Umbenennen) bitte nicht benutzen. VS Code pinnt dann den Namen fest und ignoriert die Titel-Sequenzen; der Zustand wird in diesem Tab nicht mehr angezeigt.

**Wiederherstellen:** passiert automatisch, wenn ein VS-Code-Fenster ohne Terminals startet (nach Cmd+Q, Update oder Absturz). Beim bloßen Neuladen des Fensters laufen die Sitzungen weiter, es wird nichts verdoppelt. Manuell: „Claude: Sitzungen jetzt wiederherstellen“.

**Sitzung bewusst beenden:** in Claude `/exit`. Der Eintrag verschwindet dann nach wenigen Sekunden aus der Liste und wird nicht wiederhergestellt.

Weitere Befehle: „Claude: Terminal-Namen jetzt speichern“ schreibt Namen und Reihenfolge aller offenen Terminals sofort in die Liste.

## Wie es funktioniert

### Beteiligte

```
Claude Code ──Hooks──▶ ~/.claude/hooks/tab-status.sh      ──▶ Titel-Sequenz ins Terminal-Gerät
                       ~/.claude/hooks/vscode-sessions.py ──▶ ~/.claude/vscode-sessions.json
                                                                        ▲          │
VS-Code-Erweiterung (claude-terminal-restore) ──liest Tab-Namen/Reihenfolge┘          │
                                              ◀──öffnet Terminals beim Start──────────┘
```

### Terminal Activity

Claude Code ruft bei vier Ereignissen einen Hook auf: `SessionStart`, `UserPromptSubmit`, `Notification` (Claude wartet auf Eingabe oder Freigabe) und `Stop` (Antwort fertig). `tab-status.sh` schreibt dann die Titel-Sequenz `ESC ] 0 ; <Titel> BEL` und bei „wartet“ und „fertig“ zusätzlich das Glockenzeichen. VS Code zeigt mit `terminal.integrated.tabs.title: "${sequence}"` genau diesen Titel im Tab und mit `enableVisualBell` ein Glockensymbol.

Zwei Stolpersteine, die der Hook löst:

- **Hooks haben kein Controlling-Terminal.** Claude Code startet Hooks abgekoppelt, `/dev/tty` liefert „Device not configured“. Der Hook läuft deshalb die Prozesskette hoch (Hook → `claude` → Shell), liest mit `ps -o tty=` das Terminal-Gerät der Shell (etwa `/dev/ttys018`) und schreibt direkt dorthin.
- **Fest vergebene Tab-Namen blockieren Sequenzen.** Ein Name, der über die VS-Code-API oder das Umbenennen gesetzt wurde, hat Vorrang vor `${sequence}`. Darum erzeugt die Erweiterung Terminals ohne festen Namen, und das Benennen läuft über die eigene Liste plus Titel-Sequenz.

Der Name im Titel kommt aus `~/.claude/vscode-sessions.json` (Eintrag mit passender Session-ID), sonst aus der Umgebungsvariable `CLAUDE_TERM_NAME`, sonst ist es der Ordnername. Den letzten Zustand merkt sich der Hook je Sitzung in `~/.claude/tab-status/<session-id>`, damit die Erweiterung beim Benennen den richtigen Zustand mitschreiben kann.

### Recovery

`vscode-sessions.py` läuft bei `SessionStart` und `SessionEnd`, aber nur, wenn `TERM_PROGRAM=vscode` gesetzt ist. Er führt die Liste `~/.claude/vscode-sessions.json`:

```json
{
  "entries": [
    { "slot": "…", "session_id": "…", "cwd": "/pfad", "name": "Kundenprojekt", "order": 0, "updated": "2026-11-16T12:03:44+00:00" }
  ]
}
```

- Die Session-ID kommt aus dem Dateinamen von `transcript_path`, weil `session_id` im Hook-Input bei Resume in manchen Versionen falsch war.
- Schreibzugriffe laufen mit Dateisperre und atomar (temporäre Datei plus `os.replace`), weil viele Terminals gleichzeitig schreiben.
- Einträge älter als 14 Tage werden entfernt.
- **`SessionEnd` muss unterscheiden**, ob du Claude beendet hast oder VS Code geschlossen wurde. Der Hook startet einen abgelösten Hintergrundprozess, der 3 Sekunden wartet und dann prüft, ob die Shell noch lebt. Shell lebt: du hast `/exit` getippt, der Eintrag fliegt raus (nur, wenn die Session-ID noch stimmt, sonst käme bei `/clear` der neue Start dazwischen). Shell weg: VS Code wurde geschlossen, der Eintrag bleibt.

Die Erweiterung aktiviert sich bei `onStartupFinished`, wartet 3 Sekunden und prüft, ob das Fenster Terminals hat. Hat es welche, wurde nur neu geladen, und sie übernimmt nur Namen und Reihenfolge. Hat es keine, öffnet sie für jeden Eintrag, dessen Ordner im Fenster geöffnet ist, ein Terminal mit `cwd`, den Umgebungsvariablen `CLAUDE_TERM_SLOT` und `CLAUDE_TERM_NAME` und schickt `claude --resume <Session-ID>`. Zwischen zwei Terminals liegen 500 ms, das zuletzt erzeugte Terminal wird nicht fokussiert.

Alle 5 Sekunden gleicht die Erweiterung Tab-Namen und Reihenfolge ab: Über `terminal.processId` bekommt sie die PID der Shell, sucht in `ps` den `claude`-Kindprozess und liest dessen Session-ID aus `~/.claude/sessions/<pid>.json`, das Claude Code selbst pflegt. Aus dem Tab-Titel streicht sie das Statuspräfix („🔵 läuft · “) und Claudes Aktivitätszeichen, bevor sie den Namen speichert.

`terminal.integrated.persistentSessionReviveProcess: "never"` sorgt dafür, dass VS Code nach dem Schließen keine leeren Terminals mehr anlegt, die sich mit den wiederhergestellten verdoppeln würden. Nachteil: Andere Terminals kommen nach einem Neustart nicht mehr mit altem Verlauf zurück. Beim Neuladen des Fensters bleibt alles erhalten.

## Dateien

| Pfad | Zweck |
|---|---|
| `hooks/tab-status.sh` | Status-Hook: Titel-Sequenz und Glocke ins Terminal-Gerät, Zustand nach `~/.claude/tab-status/` |
| `hooks/vscode-sessions.py` | Recovery-Hook: pflegt `~/.claude/vscode-sessions.json` |
| `extension/` | VS-Code-Erweiterung `claude-terminal-restore` (reines JavaScript, kein Build-Schritt) |
| `settings/claude-settings.snippet.json` | Hook-Einträge und `env` für `~/.claude/settings.json` |
| `settings/vscode-settings.snippet.json` | Drei Schlüssel für die VS-Code-`settings.json` |
| `install.sh` | Richtet alles ein, mit Sicherungskopien |

Zur Laufzeit entstehen `~/.claude/vscode-sessions.json` (Liste), `~/.claude/vscode-sessions.json.lock` (Sperre) und `~/.claude/tab-status/<session-id>` (letzter Zustand).

## Einschränkungen

- Ein einzelnes Terminal mit laufendem Claude über den Mülleimer zu schließen lässt den Eintrag stehen; das Terminal kommt beim nächsten Start zurück. Vorher `/exit`, wenn das nicht gewünscht ist.
- Sitzungen, die vor der Installation liefen, kennen die Hooks noch nicht. Sie landen erst nach einem Neustart der Sitzung in der Liste. Die Erweiterung trägt sie aber über den 5-Sekunden-Abgleich ein, sobald sie läuft.
- Die Reihenfolge entspricht der Reihenfolge in `vscode.window.terminals`, also der Erstellungsreihenfolge. Per Drag verschobene Tabs werden nicht erkannt.
- Hooks werden von Claude Code beim Start geladen. Änderungen an `~/.claude/settings.json` gelten für neue Sitzungen.

## Fehlersuche

- **Kein Status im Tab:** Wurde das Terminal umbenannt oder mit festem Namen erzeugt? Dann pinnt VS Code den Namen. Neues Terminal ohne Namen öffnen und `claude` starten. Steht `"terminal.integrated.tabs.title": "${sequence}"` in den VS-Code-Einstellungen?
- **Status stimmt, aber kein Name:** `~/.claude/vscode-sessions.json` prüfen, ob ein Eintrag mit dieser Session-ID und `name` existiert. Mit „Claude: Terminal benennen“ setzen.
- **Nichts wird wiederhergestellt:** Liegt der Ordner (`cwd`) der Einträge innerhalb eines im Fenster geöffneten Workspace-Ordners? Gibt es den Ordner noch? Hat das Fenster beim Start schon Terminals (dann wird bewusst nichts getan)?
- **Doppelte Terminals nach Neustart:** `terminal.integrated.persistentSessionReviveProcess` muss auf `"never"` stehen.
- Hook von Hand testen: `echo '{}' | ~/.claude/hooks/tab-status.sh waiting` muss ohne Ausgabe mit Exit 0 enden; `TERM_PROGRAM=vscode python3 ~/.claude/hooks/vscode-sessions.py` mit JSON auf stdin ebenso.

## Deinstallation

```bash
code --uninstall-extension local.claude-terminal-restore
rm ~/.claude/hooks/tab-status.sh ~/.claude/hooks/vscode-sessions.py
rm -rf ~/.claude/vscode-sessions.json ~/.claude/vscode-sessions.json.lock ~/.claude/tab-status
```

Dann die Hook-Einträge und `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` aus `~/.claude/settings.json` sowie die drei Schlüssel aus der VS-Code-`settings.json` entfernen (oder die `.bak-<datum>`-Kopien zurückspielen).

## Lizenz

MIT, siehe [LICENSE](LICENSE). © [marketer UX](https://www.marketer-ux.com)
