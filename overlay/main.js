const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, safeStorage, screen, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { io } = require("socket.io-client");
const { linkWithSteam } = require("./steam-link");
const { resolveServerUrl } = require("./server-url");

const ALLOW_CAPTURE = process.argv.includes("--allow-capture");
const NO_WATCHER = process.argv.includes("--no-watcher");
const START_ROOM = process.argv.find((a) => a.startsWith("--room="))?.slice(7).toLowerCase() ?? null;
const ROOM_RE = /^p[a-z0-9]{4}(?:-[a-z0-9]{5}){0,2}$/;
const ICON = path.join(__dirname, "icon.png");
const MIN_W = 260;
const MIN_H = 140;

let SERVER;
try {
  SERVER = resolveServerUrl();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.log(`ARC Chat overlay server: ${SERVER.url}${SERVER.overridden ? " (dev override)" : ""}`);

const LOOK_DEFAULTS = {
  fontSize: 15,
  textColor: "#ececec",
  shadowOpacity: 0.9,
  ownNameColor: "#f6c21b",
  namesColorful: true,
  nameColor: "#7cc6fe",
  showTime: true,
  timeColor: "#8a8a8a",
  systemColor: "#a0a0a0",
  lineBgColor: "#000000",
  lineBgOpacity: 0.4,
  panelColor: "#0c0c0c",
  panelOpacity: 0.75,
  inputBgColor: "#000000",
  inputBgOpacity: 0.6,
  accentColor: "#f6c21b",
  windowOpacity: 1,
  fadeEnabled: true,
  fadeSeconds: 15,
};

const DEFAULTS = {
  serverUrl: SERVER.url,
  pythonPath: "python",
  watcherPath: path.join(__dirname, "..", "arc_watcher.py"),
  hotkeyChat: "F9",
  hotkeyEdit: "F10",
  hideFromCapture: true,
  bounds: null,
  mutedPlayers: [],
  ...LOOK_DEFAULTS,
};

const MAX_MUTES = 200;
const cleanMutes = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p.id === "string" && /^steam:[a-f0-9]{20}$/.test(p.id))
    .slice(0, MAX_MUTES)
    .map((p) => ({ id: p.id, name: String(p.name ?? "").slice(0, 40) }));

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const color = (v) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : undefined);
const bool = (v) => Boolean(v);
const num = (lo, hi) => (v) => (Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : undefined);
const int = (lo, hi) => (v) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : undefined);

const LOOK_SCHEMA = {
  fontSize: int(10, 36),
  textColor: color,
  shadowOpacity: num(0, 1),
  ownNameColor: color,
  namesColorful: bool,
  nameColor: color,
  showTime: bool,
  timeColor: color,
  systemColor: color,
  lineBgColor: color,
  lineBgOpacity: num(0, 1),
  panelColor: color,
  panelOpacity: num(0, 1),
  inputBgColor: color,
  inputBgOpacity: num(0, 1),
  accentColor: color,
  windowOpacity: num(0.2, 1),
  fadeEnabled: bool,
  fadeSeconds: int(3, 600),
};

let settings;
let firstRun = false;
let win;
let settingsWin = null;
let tray = null;
let socket;
let watcher;
let mode = "play";
let room = null;
let selfId = null;
let connection = "offline";
let watcherState = "starting";
let resizeOrigin = null;
let moveOrigin = null;
let account = null;
let linkAbort = null;
let lastNotice = "";
let boundsTimer;

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8").replace(/^﻿/, ""));
  } catch {}
  const s = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (key in saved) s[key] = saved[key];
  for (const [key, check] of Object.entries(LOOK_SCHEMA)) if (check(s[key]) === undefined) s[key] = LOOK_DEFAULTS[key];
  s.serverUrl = SERVER.url;
  s.mutedPlayers = cleanMutes(s.mutedPlayers);
  return s;
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  const { serverUrl, ...persisted } = settings;
  fs.writeFileSync(settingsPath(), JSON.stringify(persisted, null, 2));
}

function publicSettings() {
  const { pythonPath, watcherPath, bounds, serverUrl, ...rest } = settings;
  return rest;
}

function send(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data);
}

function cleanLook(patch) {
  const look = {};
  for (const [key, check] of Object.entries(LOOK_SCHEMA)) {
    if (!(key in patch)) continue;
    const value = check(patch[key]);
    if (value === undefined) return { error: `Invalid value for ${key}` };
    look[key] = value;
  }
  return { look };
}

function showLook(s) {
  if (!win || win.isDestroyed()) return;
  win.setOpacity(s.windowOpacity);
  win.webContents.send("settings", s);
}

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function initialBounds() {
  const b = settings.bounds;
  if (b && screen.getAllDisplays().some((d) => intersects(d.workArea, b))) return b;
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + 24, y: wa.y + Math.round(wa.height * 0.45), width: 440, height: 300 };
}

function persistBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    settings.bounds = win.getBounds();
    saveSettings();
  }, 400);
}

const securePrefs = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function lockDown(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
}

function createWindow() {
  win = new BrowserWindow({
    ...initialBounds(),
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: securePrefs,
  });
  lockDown(win);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);
  win.setOpacity(settings.windowOpacity);
  win.setContentProtection(settings.hideFromCapture && !ALLOW_CAPTURE);
  win.on("moved", persistBounds);
  win.on("resized", persistBounds);
  win.on("blur", () => {
    if (mode === "chat") setMode("play");
  });
  win.once("ready-to-show", () => {
    win.showInactive();
    if (firstRun) openSettings();
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 460,
    minHeight: 520,
    title: "ARC Chat settings",
    icon: ICON,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0b0d10", symbolColor: "#b9bcc2", height: 38 },
    webPreferences: securePrefs,
  });
  lockDown(settingsWin);
  settingsWin.setAlwaysOnTop(true, "screen-saver");
  settingsWin.on("focus", () => globalShortcut.unregisterAll());
  settingsWin.on("blur", () => registerHotkeys());
  settingsWin.on("closed", () => {
    settingsWin = null;
    registerHotkeys();
    showLook(publicSettings());
  });
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("ARC Chat");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Settings", click: openSettings },
      { label: "Move / resize", click: () => setMode(mode === "edit" ? "play" : "edit") },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", openSettings);
}

function setMode(next) {
  if (next === mode || !win) return;
  mode = next;
  const editing = mode === "edit";
  const typing = mode === "chat";
  win.setIgnoreMouseEvents(!editing);
  win.setFocusable(editing || typing);
  if (editing || typing) {
    win.moveTop();
    win.focus();
  } else {
    win.blur();
  }
  send("mode", mode);
}

function tryRegister(accelerator, handler) {
  try {
    return globalShortcut.register(accelerator, handler);
  } catch {
    return false;
  }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  if (!tryRegister(settings.hotkeyChat, () => setMode(mode === "chat" ? "play" : "chat"))) failed.push(settings.hotkeyChat);
  if (!tryRegister(settings.hotkeyEdit, () => setMode(mode === "edit" ? "play" : "edit"))) failed.push(settings.hotkeyEdit);
  return failed;
}

const authPath = () => path.join(app.getPath("userData"), "auth.json");

function serverOrigin() {
  try {
    return new URL(settings.serverUrl).origin;
  } catch {
    return null;
  }
}

function loadAccount() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = JSON.parse(fs.readFileSync(authPath(), "utf8"));
    const token = safeStorage.decryptString(Buffer.from(raw.token, "base64"));
    if (typeof raw.origin !== "string" || !raw.user?.name) return null;
    return { origin: raw.origin, token, user: { provider: "steam", id: String(raw.user.id), name: String(raw.user.name) } };
  } catch {
    return null;
  }
}

function saveAccount() {
  if (!account) return fs.rmSync(authPath(), { force: true });
  if (!safeStorage.isEncryptionAvailable()) return;
  const token = safeStorage.encryptString(account.token).toString("base64");
  fs.writeFileSync(authPath(), JSON.stringify({ origin: account.origin, token, user: account.user }), { mode: 0o600 });
}

function currentAuth() {
  return account && account.origin === serverOrigin() ? account : null;
}

function publicAuth() {
  const a = currentAuth();
  return { linked: Boolean(a), provider: a ? "steam" : null, name: a ? a.user.name : null };
}

function notifyOnce(text) {
  if (text === lastNotice) return;
  lastNotice = text;
  send("system", text);
}

function setConnection(status) {
  connection = status;
  send("connection", status);
}

function setWatcher(state) {
  watcherState = state;
  send("watcher", state);
}

function connect() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  if (!currentAuth()) return setConnection("signed-out");
  setConnection("connecting");
  socket = io(settings.serverUrl, {
    transports: ["websocket"],
    reconnectionDelayMax: 5000,
    auth: (cb) => cb({ token: currentAuth()?.token }),
  });
  socket.on("connect", () => {
    lastNotice = "";
    setConnection("online");
    if (room) joinRoom(room);
  });
  socket.on("disconnect", () => setConnection("offline"));
  socket.on("connect_error", (err) => {
    setConnection("offline");
    if (err?.message === "invalid token" && currentAuth()) {
      account = null;
      saveAccount();
      send("auth", publicAuth());
      notifyOnce("Your Steam session expired. Link your account again in settings.");
      connect();
    } else if (err?.message === "banned") {
      notifyOnce("Your account is banned from the chat.");
    } else if (err?.message === "auth required") {
      notifyOnce("This server requires a linked Steam account. Open settings to link yours.");
    }
  });
  socket.on("banned", () => notifyOnce("Your account is banned from the chat."));
  socket.on("message", (m) => {
    if (m?.room === room) send("message", m);
  });
  socket.on("presence", (p) => {
    if (p?.room === room) send("presence", p);
  });
}

function joinRoom(code) {
  room = code;
  send("room", room);
  tray?.setToolTip(`ARC Chat — ${room}`);
  const linked = currentAuth();
  if (!linked) return send("system", "Link your Steam account in settings to chat in this match.");
  if (!socket?.connected) return;
  socket.timeout(5000).emit("join", { room: code }, (err, res) => {
    if (err || !res?.ok) return send("system", `Could not join ${code}: ${err ? "server timeout" : res?.error}`);
    selfId = res.self.id;
    if (linked && linked.user.name !== res.self.name) {
      linked.user = { ...linked.user, name: res.self.name };
      saveAccount();
      send("auth", publicAuth());
    }
    send("joined", { room: res.room, selfId, history: res.history });
  });
}

function leaveRoom() {
  if (!room) return;
  const old = room;
  room = null;
  if (socket?.connected) socket.emit("leave");
  send("room", null);
  send("left", old);
  tray?.setToolTip("ARC Chat — lobby");
}

function startWatcher() {
  if (NO_WATCHER) return setWatcher("disabled");
  const [command, args] = app.isPackaged
    ? [path.join(process.resourcesPath, "watcher", "arc-watcher.exe"), ["--headless"]]
    : [settings.pythonPath, [settings.watcherPath, "--headless"]];
  if (!fs.existsSync(app.isPackaged ? command : settings.watcherPath)) return setWatcher("missing");
  watcher = spawn(command, args, {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  watcher.on("error", () => setWatcher("error"));
  watcher.on("exit", () => {
    watcher = null;
    setWatcher("stopped");
  });
  watcher.stderr.on("data", (d) => console.error(`[watcher] ${d}`));
  readline.createInterface({ input: watcher.stdout }).on("line", (line) => {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    if (evt.type === "code" && ROOM_RE.test(evt.value)) joinRoom(evt.value);
    else if (evt.type === "lobby") leaveRoom();
    else if (evt.type === "state") setWatcher(evt.value);
  });
}

function applySettings(patch) {
  if (!patch || typeof patch !== "object") return { ok: false, error: "Invalid settings" };
  const { look, error } = cleanLook(patch);
  if (error) return { ok: false, error };
  const next = { ...settings, ...look };

  if ("hideFromCapture" in patch) next.hideFromCapture = Boolean(patch.hideFromCapture);
  if ("hotkeyChat" in patch) next.hotkeyChat = String(patch.hotkeyChat);
  if ("hotkeyEdit" in patch) next.hotkeyEdit = String(patch.hotkeyEdit);
  if (next.hotkeyChat === next.hotkeyEdit) return { ok: false, error: "The two hotkeys must be different" };

  const prev = settings;
  settings = next;
  const failed = registerHotkeys();
  if (failed.length) {
    settings = prev;
    registerHotkeys();
    return { ok: false, error: `Hotkey unavailable (used by another app?): ${failed.join(", ")}` };
  }
  if (settingsWin?.isFocused()) globalShortcut.unregisterAll();
  saveSettings();
  firstRun = false;
  win.setContentProtection(settings.hideFromCapture && !ALLOW_CAPTURE);
  showLook(publicSettings());
  send("settings", publicSettings());
  send("auth", publicAuth());
  return { ok: true, settings: publicSettings() };
}

ipcMain.handle("get-state", () => ({
  settings: publicSettings(),
  auth: publicAuth(),
  lookDefaults: LOOK_DEFAULTS,
  mode,
  room,
  selfId,
  connection,
  watcher: watcherState,
  firstRun,
}));

ipcMain.handle("send-message", (_e, text) => {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "empty message" };
  if (!currentAuth()) return { ok: false, error: "link your Steam account in settings first" };
  if (!socket?.connected) return { ok: false, error: "server offline" };
  if (!room) return { ok: false, error: "no match detected yet" };
  return new Promise((resolve) => {
    socket.timeout(5000).emit("message", text.slice(0, 300), (err, res) => {
      resolve(err ? { ok: false, error: "server timeout" } : res);
    });
  });
});

ipcMain.handle("save-settings", (_e, patch) => applySettings(patch));

function setMutes(list) {
  settings.mutedPlayers = list;
  saveSettings();
  send("settings", publicSettings());
}

ipcMain.handle("mute-player", (_e, player) => {
  const [p] = cleanMutes([player]);
  if (!p) return { ok: false, error: "Unknown player" };
  if (p.id === selfId) return { ok: false, error: "You can't mute yourself." };
  if (settings.mutedPlayers.length >= MAX_MUTES) return { ok: false, error: "Mute list is full." };
  setMutes([...settings.mutedPlayers.filter((m) => m.id !== p.id), p]);
  return { ok: true };
});

ipcMain.handle("unmute-player", (_e, userId) => {
  setMutes(settings.mutedPlayers.filter((m) => m.id !== userId));
  return { ok: true };
});

ipcMain.handle("report-player", (_e, userId, reason) => {
  if (typeof userId !== "string") return { ok: false, error: "Unknown player" };
  if (!currentAuth()) return { ok: false, error: "link your Steam account in settings first" };
  if (!socket?.connected) return { ok: false, error: "server offline" };
  return new Promise((resolve) => {
    socket.timeout(8000).emit("report", { userId, reason: String(reason ?? "").slice(0, 200) }, (err, res) => {
      resolve(err ? { ok: false, error: "server timeout" } : res);
    });
  });
});

ipcMain.on("preview-look", (_e, patch) => {
  if (!patch || typeof patch !== "object") return;
  const { look } = cleanLook(patch);
  if (look) showLook({ ...publicSettings(), ...look });
});

ipcMain.on("revert-look", () => showLook(publicSettings()));
ipcMain.on("open-settings", () => openSettings());

ipcMain.on("set-mode", (_e, next) => {
  if (["play", "chat", "edit"].includes(next)) setMode(next);
});

ipcMain.on("resize-start", () => {
  resizeOrigin = win.getBounds();
});

ipcMain.on("resize-move", (_e, dx, dy) => {
  if (!resizeOrigin || mode !== "edit") return;
  win.setBounds({
    ...resizeOrigin,
    width: Math.max(MIN_W, Math.round(resizeOrigin.width + Number(dx))),
    height: Math.max(MIN_H, Math.round(resizeOrigin.height + Number(dy))),
  });
});

ipcMain.on("resize-end", () => {
  resizeOrigin = null;
  persistBounds();
});

ipcMain.on("move-start", () => {
  moveOrigin = win.getBounds();
});

ipcMain.on("move-by", (_e, dx, dy) => {
  if (!moveOrigin || mode !== "edit") return;
  win.setBounds({ ...moveOrigin, x: Math.round(moveOrigin.x + Number(dx)), y: Math.round(moveOrigin.y + Number(dy)) });
});

ipcMain.on("move-end", () => {
  moveOrigin = null;
  persistBounds();
});

ipcMain.handle("auth-link-steam", async () => {
  linkAbort?.abort();
  const controller = (linkAbort = new AbortController());
  settingsWin?.setAlwaysOnTop(false);
  try {
    const { token, user } = await linkWithSteam({
      serverUrl: settings.serverUrl,
      signal: controller.signal,
      onCode: (code) => send("link-code", code),
      openExternal: (url) => shell.openExternal(url),
    });
    account = { origin: serverOrigin(), token, user };
    saveAccount();
    send("auth", publicAuth());
    send("system", `Linked to Steam as ${user.name}.`);
    connect();
    return { ok: true, name: user.name };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (linkAbort === controller) {
      linkAbort = null;
      settingsWin?.setAlwaysOnTop(true, "screen-saver");
    }
  }
});

ipcMain.on("auth-cancel", () => linkAbort?.abort());

ipcMain.handle("auth-unlink", () => {
  const linked = currentAuth();
  if (linked) {
    fetch(`${linked.origin}/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${linked.token}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
  account = null;
  saveAccount();
  send("auth", publicAuth());
  send("system", "Steam account unlinked.");
  connect();
  return { ok: true };
});

ipcMain.on("quit", () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => openSettings());

  app.whenReady().then(() => {
    settings = loadSettings();
    saveSettings();
    account = loadAccount();
    firstRun = !currentAuth();
    createWindow();
    createTray();
    const failed = registerHotkeys();
    win.webContents.once("did-finish-load", () => {
      if (SERVER.overridden) send("system", `Dev server: ${SERVER.url}`);
      if (failed.length) send("system", `Hotkey unavailable: ${failed.join(", ")} — change it in settings.`);
    });
    connect();
    startWatcher();
    if (START_ROOM && ROOM_RE.test(START_ROOM)) joinRoom(START_ROOM);
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    watcher?.kill();
    socket?.disconnect();
  });

  app.on("window-all-closed", () => app.quit());
}
