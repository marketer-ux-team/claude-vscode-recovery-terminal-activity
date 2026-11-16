const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const STATE_FILE = path.join(os.homedir(), ".claude", "vscode-sessions.json");
const SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
const STARTUP_DELAY_MS = 3000;
const BETWEEN_TERMINALS_MS = 500;
const SYNC_INTERVAL_MS = 5000;
const PROCESS_REFRESH_MS = 30000;
// Titel, die der Status-Hook setzt: "<Symbol> <Zustand> · <Name>"
const STATUS_TITLE_RE = /^[⚪🔵🟡🟢]\s[^·]+·\s(.+)$/u;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

function writeState(entries) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = path.join(path.dirname(STATE_FILE), `.vscode-sessions.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2) + "\n");
    fs.renameSync(tmp, STATE_FILE);
  } catch {
    // nie den Editor stören
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ---------- Zuordnung Terminal -> Claude-Sitzung ----------

let processTable = []; // [{pid, ppid, comm}]
let processTableAt = 0;

function refreshProcessTable(force) {
  if (!force && Date.now() - processTableAt < PROCESS_REFRESH_MS) return;
  try {
    const out = execFileSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8", timeout: 5000 });
    processTable = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] } : null;
      })
      .filter(Boolean);
    processTableAt = Date.now();
  } catch {
    // Tabelle behalten
  }
}

function findClaudePid(shellPid) {
  const isClaude = (p) => /(^|\/)claude$/.test(p.comm);
  const children = processTable.filter((p) => p.ppid === shellPid);
  const direct = children.find(isClaude);
  if (direct) return direct.pid;
  for (const c of children) {
    const grand = processTable.find((p) => p.ppid === c.pid && isClaude(p));
    if (grand) return grand.pid;
  }
  return null;
}

function readSessionInfo(claudePid) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${claudePid}.json`), "utf8"));
    if (!d.sessionId || !d.cwd) return null;
    return { sessionId: d.sessionId, cwd: d.cwd, autoName: d.name || "" };
  } catch {
    return null;
  }
}

// Terminal-Objekt -> {sessionId, cwd, autoName}; wird bei Bedarf neu ermittelt
const termCache = new WeakMap();

async function resolveTerminal(t) {
  const cached = termCache.get(t);
  if (cached && cached.sessionId) return cached;
  let shellPid = null;
  try {
    shellPid = await t.processId;
  } catch {
    return null;
  }
  if (!shellPid) return null;
  refreshProcessTable(false);
  let claudePid = findClaudePid(shellPid);
  if (!claudePid) {
    refreshProcessTable(true);
    claudePid = findClaudePid(shellPid);
  }
  if (!claudePid) return null;
  const info = readSessionInfo(claudePid);
  if (!info) return null;
  termCache.set(t, info);
  return info;
}

function customName(t, info, fallback) {
  let name = (t.name || "").trim();
  const m = name.match(STATUS_TITLE_RE);
  if (m) name = m[1].trim();
  name = name.replace(/^[✳◑◐◒◓✱✶☀-➿\s]+/u, "").trim(); // Claude-Aktivitätszeichen vorn
  if (!name) return null;
  if (name === fallback) return null; // nur Ordnername, nichts Eigenes
  if (name === path.basename(info.cwd)) return null;
  if (/^Claude · /.test(name)) name = name.replace(/^Claude · /, "");
  return name;
}

let syncing = false;

async function syncNames() {
  if (syncing) return;
  syncing = true;
  try {
    const terminals = vscode.window.terminals;
    if (terminals.length === 0) return;
    const entries = readState();
    const bySlot = new Map(entries.map((e) => [e.slot, e]));
    const bySession = new Map(entries.map((e) => [e.session_id, e]));
    let changed = false;
    let order = 0;
    for (const t of terminals) {
      const info = await resolveTerminal(t);
      if (!info) continue;
      const slot = t.creationOptions && t.creationOptions.env && t.creationOptions.env.CLAUDE_TERM_SLOT;
      let e = (slot && bySlot.get(slot)) || bySession.get(info.sessionId);
      const folder = path.basename(info.cwd);
      if (!e) {
        e = { slot: slot || info.sessionId, session_id: info.sessionId, cwd: info.cwd, name: folder };
        entries.push(e);
        bySlot.set(e.slot, e);
        bySession.set(e.session_id, e);
        changed = true;
      }
      if (e.session_id !== info.sessionId) {
        e.session_id = info.sessionId;
        changed = true;
      }
      const name = customName(t, info, folder);
      const wanted = name || (e.name && e.name !== folder ? e.name : null) || info.autoName || folder;
      if (e.name !== wanted) {
        e.name = wanted;
        changed = true;
      }
      if (e.order !== order) {
        e.order = order;
        changed = true;
      }
      order += 1;
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
      if (!e.updated || Date.now() - Date.parse(e.updated) > 60000) {
        e.updated = now;
        changed = true;
      }
    }
    if (changed) {
      entries.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
      writeState(entries);
    }
  } catch {
    // still bleiben
  } finally {
    syncing = false;
  }
}

// ---------- Wiederherstellen ----------

function entriesForThisWindow() {
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  if (folders.length === 0) return [];
  return readState()
    .filter((e) => {
      if (!e || !e.cwd || !e.session_id || !e.slot) return false;
      if (!folders.some((f) => isInside(e.cwd, f))) return false;
      try {
        return fs.statSync(e.cwd).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
}

async function restore() {
  const entries = entriesForThisWindow();
  let count = 0;
  for (const e of entries) {
    const name = e.name || path.basename(e.cwd);
    // Kein fester Name: ein per API gesetzter Name blockiert die Titel-Sequenz des Status-Hooks.
    // Der Hook setzt den Titel "<Status> · <Name>" selbst (Name aus CLAUDE_TERM_NAME).
    const t = vscode.window.createTerminal({
      cwd: e.cwd,
      env: { CLAUDE_TERM_SLOT: e.slot, CLAUDE_TERM_NAME: name },
    });
    t.sendText(`claude --resume ${e.session_id}`);
    count += 1;
    await sleep(BETWEEN_TERMINALS_MS);
  }
  vscode.window.showInformationMessage(`${count} Claude-Sitzungen wiederhergestellt`);
  return count;
}

// ---------- Terminal benennen (ohne festen API-Namen, über die Titel-Sequenz) ----------

const STATUS_DIR = path.join(os.homedir(), ".claude", "tab-status");
const STATE_LABEL = { idle: "⚪ bereit", running: "🔵 läuft", waiting: "🟡 wartet auf dich", done: "🟢 fertig" };

function ttyOfShell(shellPid) {
  try {
    const tty = execFileSync("ps", ["-o", "tty=", "-p", String(shellPid)], { encoding: "utf8", timeout: 3000 }).trim();
    return tty && tty !== "??" ? `/dev/${tty}` : null;
  } catch {
    return null;
  }
}

function lastState(sessionId) {
  try {
    const s = fs.readFileSync(path.join(STATUS_DIR, sessionId), "utf8").trim();
    return STATE_LABEL[s] ? s : "idle";
  } catch {
    return "idle";
  }
}

async function writeTitle(t, info, name) {
  let shellPid = null;
  try {
    shellPid = await t.processId;
  } catch {
    return false;
  }
  const dev = shellPid && ttyOfShell(shellPid);
  if (!dev) return false;
  try {
    fs.writeFileSync(dev, `\x1b]0;${STATE_LABEL[lastState(info.sessionId)]} · ${name}\x07`);
    return true;
  } catch {
    return false;
  }
}

async function renameActive() {
  const t = vscode.window.activeTerminal;
  if (!t) {
    vscode.window.showWarningMessage("Kein aktives Terminal.");
    return;
  }
  const info = await resolveTerminal(t);
  if (!info) {
    vscode.window.showWarningMessage("In diesem Terminal läuft keine Claude-Sitzung.");
    return;
  }
  const entries = readState();
  const e = entries.find((x) => x.session_id === info.sessionId);
  const name = await vscode.window.showInputBox({
    prompt: "Name für dieses Claude-Terminal",
    value: (e && e.name) || "",
    ignoreFocusOut: true,
  });
  if (!name || !name.trim()) return;
  const clean = name.trim();
  if (e) e.name = clean;
  else entries.push({ slot: info.sessionId, session_id: info.sessionId, cwd: info.cwd, name: clean, updated: new Date().toISOString() });
  writeState(entries);
  const ok = await writeTitle(t, info, clean);
  if (!ok) vscode.window.showInformationMessage(`Name gespeichert: ${clean}. Titel folgt beim nächsten Claude-Ereignis.`);
}

// ---------- Activity: Liste „Claude Sitzungen“ und Statusleiste ----------
// Quelle des Zustands: ~/.claude/tab-status/<session-id>, geschrieben vom Hook tab-status.sh.
// Tab-Titel allein reichen nicht: VS Code übernimmt bei Terminals mit laufendem Claude
// nach dem ersten Titel keine weiteren Titel-Sequenzen mehr.

const STATE_ICON = {
  idle: ["circle-large-outline", undefined],
  running: ["sync~spin", "charts.blue"],
  waiting: ["bell-dot", "charts.yellow"],
  done: ["pass-filled", "charts.green"],
};
const STATE_TEXT = { idle: "bereit", running: "läuft", waiting: "wartet auf dich", done: "fertig" };

function stateInfo(sessionId) {
  const file = path.join(STATUS_DIR, sessionId);
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    const since = fs.statSync(file).mtimeMs;
    return { state: STATE_TEXT[s] ? s : "idle", since };
  } catch {
    return { state: "idle", since: 0 };
  }
}

function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  return h < 24 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tg.`;
}

async function collectSessions() {
  const entries = readState();
  const out = [];
  for (const t of vscode.window.terminals) {
    const info = await resolveTerminal(t);
    if (!info) continue;
    const e = entries.find((x) => x.session_id === info.sessionId);
    const name = (e && e.name) || info.autoName || path.basename(info.cwd);
    out.push({ terminal: t, info, name, ...stateInfo(info.sessionId) });
  }
  return out;
}

class SessionsProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this.items = [];
  }
  refresh(items) {
    this.items = items;
    this._emitter.fire();
  }
  getChildren() {
    return this.items;
  }
  getTreeItem(s) {
    const it = new vscode.TreeItem(s.name, vscode.TreeItemCollapsibleState.None);
    const [icon, color] = STATE_ICON[s.state];
    it.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    it.description = `${STATE_TEXT[s.state]}${s.since ? " · " + ago(s.since) : ""}`;
    it.tooltip = `${s.name}\n${STATE_TEXT[s.state]} ${ago(s.since)}\n${s.info.cwd}`;
    it.command = { command: "claudeTerminalRestore.focus", title: "Terminal zeigen", arguments: [s.terminal] };
    it.contextValue = s.state;
    return it;
  }
}

let provider;
let statusItem;
let treeView;
let lastAttention = new Set();

async function refreshActivity() {
  if (!provider) return;
  const items = await collectSessions();
  provider.refresh(items);
  const count = (st) => items.filter((s) => s.state === st).length;
  const running = count("running");
  const waiting = count("waiting");
  const done = count("done");
  const parts = [];
  if (running) parts.push(`$(sync~spin) ${running}`);
  if (waiting) parts.push(`$(bell-dot) ${waiting}`);
  if (done) parts.push(`$(pass-filled) ${done}`);
  statusItem.text = parts.length ? `Claude ${parts.join("  ")}` : "Claude $(circle-large-outline)";
  statusItem.tooltip = `${running} laufen · ${waiting} warten auf dich · ${done} fertig`;
  statusItem.backgroundColor = waiting ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  statusItem.show();
  if (treeView) treeView.badge = waiting ? { value: waiting, tooltip: `${waiting} warten auf dich` } : undefined;

  // Hinweis, sobald eine Sitzung neu auf „wartet“ springt
  const attention = new Set(items.filter((s) => s.state === "waiting").map((s) => s.info.sessionId));
  for (const s of items) {
    if (s.state === "waiting" && !lastAttention.has(s.info.sessionId) && vscode.window.activeTerminal !== s.terminal) {
      vscode.window.setStatusBarMessage(`$(bell-dot) ${s.name} wartet auf dich`, 8000);
    }
  }
  lastAttention = attention;
}

async function pickSession() {
  const items = await collectSessions();
  const order = { waiting: 0, done: 1, running: 2, idle: 3 };
  items.sort((a, b) => order[a.state] - order[b.state]);
  const pick = await vscode.window.showQuickPick(
    items.map((s) => ({
      label: `$(${STATE_ICON[s.state][0].replace("~spin", "")}) ${s.name}`,
      description: `${STATE_TEXT[s.state]} ${ago(s.since)}`,
      s,
    })),
    { placeHolder: "Claude-Sitzung öffnen" }
  );
  if (pick) pick.s.terminal.show(false);
}

async function onStartup() {
  await sleep(STARTUP_DELAY_MS);
  if (vscode.window.terminals.length > 0) {
    await syncNames(); // Fenster nur neu geladen: Namen und Reihenfolge übernehmen
    return;
  }
  await restore();
}

async function manualRestore() {
  if (vscode.window.terminals.length > 0) {
    const pick = await vscode.window.showWarningMessage(
      "Es sind bereits Terminals offen. Claude-Sitzungen trotzdem wiederherstellen?",
      { modal: true },
      "Wiederherstellen"
    );
    if (pick !== "Wiederherstellen") return;
  }
  await restore();
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeTerminalRestore.restore", manualRestore),
    vscode.commands.registerCommand("claudeTerminalRestore.sync", syncNames),
    vscode.commands.registerCommand("claudeTerminalRestore.rename", renameActive),
    vscode.window.onDidOpenTerminal(() => setTimeout(syncNames, 4000)),
    vscode.window.onDidChangeTerminalState(() => syncNames())
  );
  const timer = setInterval(syncNames, SYNC_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Activity
  provider = new SessionsProvider();
  treeView = vscode.window.createTreeView("claudeSessions", { treeDataProvider: provider });
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = "claudeTerminalRestore.pick";
  context.subscriptions.push(
    treeView,
    statusItem,
    vscode.commands.registerCommand("claudeTerminalRestore.focus", (t) => t && t.show(false)),
    vscode.commands.registerCommand("claudeTerminalRestore.pick", pickSession),
    vscode.window.onDidOpenTerminal(() => setTimeout(refreshActivity, 4000)),
    vscode.window.onDidCloseTerminal(() => refreshActivity())
  );
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    let pending;
    const watcher = fs.watch(STATUS_DIR, () => {
      clearTimeout(pending);
      pending = setTimeout(() => refreshActivity().catch(() => {}), 150);
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // Fallback ist der Intervall-Abgleich
  }
  const activityTimer = setInterval(() => refreshActivity().catch(() => {}), 15000);
  context.subscriptions.push({ dispose: () => clearInterval(activityTimer) });
  setTimeout(() => refreshActivity().catch(() => {}), 2000);

  onStartup().catch(() => {});
}

function deactivate() {}

module.exports = { activate, deactivate };
