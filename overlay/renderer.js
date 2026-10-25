const $ = (id) => document.getElementById(id);

const body = document.body;
const list = $("messages");
const input = $("input");
const composer = $("composer");

const MAX_DOM_MESSAGES = 150;
const NAME_COLORS = ["#3fe0e0", "#24d36e", "#fae811", "#ff8a1f", "#ee3b36", "#ff5fa8", "#9a8cff", "#3b9cff"];

let settings = {};
let selfId = null;
let mode = "play";
let connection = null;

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function colorFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function paintNames() {
  for (const el of list.querySelectorAll(".name[data-uid]")) {
    el.style.color = settings.namesColorful ? colorFor(el.dataset.uid) : "";
  }
}

function applySettings(s) {
  settings = s;
  const root = document.documentElement.style;
  root.setProperty("--font-size", `${s.fontSize}px`);
  root.setProperty("--text", s.textColor);
  root.setProperty("--shadow", `rgba(0, 0, 0, ${s.shadowOpacity})`);
  root.setProperty("--own-name", s.ownNameColor);
  root.setProperty("--name", s.nameColor);
  root.setProperty("--time", s.timeColor);
  root.setProperty("--system", s.systemColor);
  root.setProperty("--line-bg", hexToRgba(s.lineBgColor, s.lineBgOpacity));
  root.setProperty("--panel-bg", hexToRgba(s.panelColor, s.panelOpacity));
  root.setProperty("--input-bg", hexToRgba(s.inputBgColor, s.inputBgOpacity));
  root.setProperty("--accent", s.accentColor);
  body.classList.toggle("no-time", !s.showTime);
  $("done-key").textContent = s.hotkeyEdit ?? "F10";
  paintNames();
  hideMuted();
}

function setMode(next) {
  mode = next;
  body.classList.remove("mode-play", "mode-chat", "mode-edit");
  body.classList.add(`mode-${next}`);
  if (next === "chat") {
    input.value = "";
    input.focus();
  } else {
    input.blur();
  }
  scrollToBottom();
}

function setRoom(code) {
  input.placeholder = code ? `Message ${code} — Enter to send, Esc to cancel` : "No match detected yet — Esc to cancel";
}

function isNearBottom() {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
}

function scrollToBottom() {
  list.scrollTop = list.scrollHeight;
}

function appendLine(li) {
  const stick = mode !== "chat" || isNearBottom();
  li.dataset.arrived = String(Date.now());
  list.append(li);
  while (list.children.length > MAX_DOM_MESSAGES) list.firstElementChild.remove();
  if (stick) scrollToBottom();
}

const seen = new Map();
const mutedIds = () => new Set((settings.mutedPlayers ?? []).map((p) => p.id));
const knownPlayers = () => [...seen].map(([id, name]) => ({ id, name }));

function hideMuted() {
  const muted = mutedIds();
  for (const el of list.querySelectorAll(".name[data-uid]")) if (muted.has(el.dataset.uid)) el.parentElement.remove();
}

function addMessage(m) {
  if (m.user.id !== selfId) seen.set(m.user.id, m.user.name);
  if (mutedIds().has(m.user.id)) return;
  const li = document.createElement("li");
  li.className = "msg";

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const name = document.createElement("span");
  name.className = "name";
  name.dataset.uid = m.user.id;
  name.textContent = m.user.name;
  if (m.user.id === selfId) li.classList.add("self");
  else if (settings.namesColorful) name.style.color = colorFor(m.user.id);
  if (m.user.provider === "steam") li.classList.add("verified");

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = m.text;

  li.append(time, name, text);
  appendLine(li);
}

function addSystem(text) {
  const li = document.createElement("li");
  li.className = "msg system";
  li.textContent = text;
  appendLine(li);
}

function setConnection(status) {
  if (connection === "online" && status === "offline") addSystem("Lost connection to the chat server — retrying…");
  if (connection === "offline" && status === "online") addSystem("Reconnected to the chat server.");
  connection = status;
}

setInterval(() => {
  const fading = settings.fadeEnabled;
  const limit = (settings.fadeSeconds ?? 15) * 1000;
  const now = Date.now();
  for (const li of list.children) {
    li.classList.toggle("faded", fading && now - Number(li.dataset.arrived) > limit);
  }
}, 500);

async function runCommand(text) {
  const { COMMANDS, parse, resolvePlayer } = ArcCommands;
  const { name, args } = parse(text);
  if (name === "help") {
    for (const c of Object.values(COMMANDS)) addSystem(`${c.usage} — ${c.help}`);
    return;
  }
  if (name === "mutes") {
    const muted = settings.mutedPlayers ?? [];
    addSystem(muted.length ? `Muted: ${muted.map((p) => p.name || p.id).join(", ")}` : "You haven't muted anyone.");
    return;
  }
  if (!COMMANDS[name]) return addSystem(`Unknown command /${name}. Type /help.`);
  const pool = name === "unmute" ? (settings.mutedPlayers ?? []) : knownPlayers();
  const found = resolvePlayer(args, pool);
  if (found.error) return addSystem(found.error);
  const { player, rest } = found;
  if (name === "mute") {
    const res = await arc.mutePlayer(player);
    addSystem(res?.ok ? `Muted ${player.name}. /unmute ${player.name} to undo.` : `Not muted: ${res?.error}`);
  } else if (name === "unmute") {
    await arc.unmutePlayer(player.id);
    addSystem(`Unmuted ${player.name}.`);
  } else {
    const res = await arc.reportPlayer(player.id, rest);
    addSystem(res?.ok ? `Report sent for ${player.name}. Thank you.` : `Report not sent: ${res?.error}`);
  }
}

let tabState = null;
input.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return tabState && e.key.length === 1 && (tabState = null);
  e.preventDefault();
  if (!tabState || input.value !== tabState.options[tabState.i]) {
    tabState = { options: ArcCommands.suggest(input.value, knownPlayers()), i: -1 };
  }
  if (!tabState.options.length) return;
  tabState.i = (tabState.i + 1) % tabState.options.length;
  input.value = tabState.options[tabState.i];
});

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return arc.setMode("play");
  if (text.startsWith("/")) {
    input.disabled = true;
    await runCommand(text);
    input.disabled = false;
    input.value = "";
    return arc.setMode("play");
  }
  input.disabled = true;
  const res = await arc.sendMessage(text);
  input.disabled = false;
  if (res?.ok) {
    input.value = "";
    arc.setMode("play");
  } else {
    addSystem(`Not sent: ${res?.error ?? "unknown error"}`);
    input.focus();
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    arc.setMode("play");
  } else if (e.key === "PageUp" || e.key === "PageDown") {
    e.preventDefault();
    list.scrollBy(0, (e.key === "PageUp" ? -1 : 1) * list.clientHeight * 0.8);
  }
});

$("btn-settings").addEventListener("click", () => arc.openSettings());
$("btn-done").addEventListener("click", () => arc.setMode("play"));

function trackDrag(el, e, start, move, end) {
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  const startX = e.screenX;
  const startY = e.screenY;
  start();
  const onMove = (ev) => move(ev.screenX - startX, ev.screenY - startY);
  const onUp = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    end();
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
}

const grip = $("resize-grip");
grip.addEventListener("pointerdown", (e) => {
  if (e.button === 0) trackDrag(grip, e, arc.resizeStart, arc.resizeMove, arc.resizeEnd);
});

const frame = $("frame");
frame.addEventListener("pointerdown", (e) => {
  if (mode !== "edit" || e.button !== 0 || e.target.closest("button, #resize-grip, #edit-bar")) return;
  trackDrag(frame, e, arc.moveStart, arc.moveBy, arc.moveEnd);
});

document.addEventListener("keydown", (e) => {
  if (mode === "edit" && e.key === "Escape") arc.setMode("play");
});

arc.onMode(setMode);
arc.onSettings(applySettings);
arc.onRoom(setRoom);
arc.onConnection(setConnection);
arc.onSystem(addSystem);
arc.onMessage(addMessage);
arc.onLeft((code) => addSystem(`Back to lobby — left match ${code}`));
arc.onJoined(({ room, selfId: id, history }) => {
  selfId = id;
  list.replaceChildren();
  seen.clear();
  addSystem(`Joined match ${room}`);
  for (const m of history) addMessage(m);
});

(async () => {
  const state = await arc.getState();
  applySettings(state.settings);
  selfId = state.selfId;
  connection = state.connection;
  setMode(state.mode);
  setRoom(state.room);
  addSystem(`ARC Chat ready — ${state.settings.hotkeyChat} to type, ${state.settings.hotkeyEdit} to move.`);
})();
