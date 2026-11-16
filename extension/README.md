# claude-terminal-restore

VS-Code-Erweiterung aus dem Repo „Claude VS Code Recovery + Terminal Activity“ von marketer UX.

- Stellt beim Start eines Fensters ohne Terminals alle Terminals mit Claude-Code-Sitzungen wieder her (`claude --resume`), Reihenfolge und Namen aus `~/.claude/vscode-sessions.json`.
- Gleicht alle 15 Sekunden Namen und Reihenfolge der offenen Claude-Terminals mit dieser Liste ab.
- Befehle: „Claude: Sitzungen jetzt wiederherstellen“, „Claude: Terminal benennen“, „Claude: Terminal-Namen jetzt speichern“.

Setup, Funktionsweise und Hooks: siehe README im Hauptordner.

Bauen: `yes | npx --yes vsce package --allow-missing-repository` · Installieren: `code --install-extension claude-terminal-restore-<version>.vsix`
