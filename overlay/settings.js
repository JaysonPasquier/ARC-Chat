const $ = (id) => document.getElementById(id);
const form = $("form");
const errorBox = $("error");

const WATCHER_LABELS = {
  starting: "watcher starting",
  SEARCHING: "looking for a match",
  WAITING_JOUER: "in a match",
  PAUSED: "game not in front",
  missing: "watcher script not found",
  error: "watcher failed to start",
  stopped: "watcher stopped",
  disabled: "watcher off",
};

const CONNECTION_LABELS = {
  online: "Online",
  connecting: "Connecting",
  offline: "Offline",
  "signed-out": "Not linked",
};

const PRESETS = [
  "#f6c21b", "#ff8a1f", "#ee3b36", "#ff5fa8", "#9a8cff", "#3b9cff", "#3fe0e0", "#24d36e", "#9be53d",
  "#ffffff", "#e8e6e1", "#c9c9c9", "#9a9a9a", "#6a6a6a", "#3a3a3a", "#1a1a1a", "#0c0c0c", "#000000",
];

let saved = {};
let lookDefaults = {};
let auth = { linked: false, name: null };
let linking = false;
let status = { connection: "offline", room: null, watcher: "starting" };

function showTab(name) {
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("active", tab.dataset.tab === name);
  for (const panel of document.querySelectorAll(".panel")) panel.hidden = panel.dataset.panel !== name;
  closePalette();
  document.querySelector("main").scrollTop = 0;
}
for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => showTab(tab.dataset.tab));

function fields() {
  return [...form.elements].filter((el) => el.name);
}

function fill(s) {
  for (const el of fields()) {
    if (!(el.name in s)) continue;
    if (el.type === "checkbox") el.checked = Boolean(s[el.name]);
    else el.value = s[el.name];
  }
  refresh();
}

function read() {
  const out = {};
  for (const el of fields()) {
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "range" || el.type === "number") out[el.name] = Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

function refresh() {
  for (const out of form.querySelectorAll("output[data-for]")) {
    const v = Number(form.elements[out.dataset.for].value);
    const unit = out.dataset.unit;
    out.textContent = unit === "%" ? `${Math.round(v * 100)}%` : `${v}${unit}`;
  }
  for (const range of form.querySelectorAll('input[type="range"]')) {
    const p = ((range.value - range.min) / (range.max - range.min)) * 100;
    range.style.setProperty("--p", `${p}%`);
  }
  for (const row of form.querySelectorAll("[data-depends]")) {
    const dep = row.dataset.depends;
    const negate = dep.startsWith("!");
    const on = form.elements[negate ? dep.slice(1) : dep].checked;
    row.classList.toggle("disabled", negate ? on : !on);
  }
  syncColors();
}

// kind: true / "ok" = success, "hint" = guidance, otherwise an error
function showError(text, kind) {
  errorBox.textContent = text;
  errorBox.className = kind === true || kind === "ok" ? "ok" : kind === "hint" ? "hint" : "";
}

function renderStatus() {
  $("status-dot").className = status.connection;
  $("status-server").textContent = CONNECTION_LABELS[status.connection] ?? status.connection;
  const watcher = WATCHER_LABELS[status.watcher] ?? status.watcher;
  $("status-match").textContent = status.room ? `${watcher} · ${status.room}` : watcher;
}

const palette = $("palette");
const paletteHex = $("palette-hex");
const sv = $("sv");
const hue = $("hue");
let activeColor = null;
let hsv = [0, 0, 1];

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function syncColors() {
  for (const field of form.querySelectorAll(".color-field")) {
    const input = field.querySelector("input");
    field.querySelector(".swatch").style.setProperty("--sw", input.value);
    field.querySelector(".hex").textContent = input.value.toUpperCase();
  }
}

function drawPicker(hex) {
  sv.style.setProperty("--hue", `hsl(${hsv[0]} 100% 50%)`);
  $("sv-knob").style.left = `${hsv[1] * 100}%`;
  $("sv-knob").style.top = `${(1 - hsv[2]) * 100}%`;
  $("hue-knob").style.left = `${(hsv[0] / 360) * 100}%`;
  $("palette-preview").style.setProperty("--sw", hex);
  for (const chip of $("palette-grid").children) chip.classList.toggle("on", chip.dataset.color === hex);
}

// From a typed or picked hex value: keep the current hue for greys so the hue bar doesn't jump.
function loadHex(hex, { updateField = true } = {}) {
  const [h, s, v] = rgbToHsv(...hexToRgb(hex));
  hsv = [s && v ? h : hsv[0], s, v];
  if (updateField) {
    paletteHex.value = hex.toUpperCase();
    paletteHex.classList.remove("bad");
  }
  drawPicker(hex);
}

function commit(hex, opts) {
  if (!activeColor) return;
  activeColor.value = hex;
  activeColor.dispatchEvent(new Event("input", { bubbles: true }));
  loadHex(hex, opts);
}

function commitHsv() {
  if (!activeColor) return;
  const hex = rgbToHex(...hsvToRgb(...hsv));
  activeColor.value = hex;
  activeColor.dispatchEvent(new Event("input", { bubbles: true }));
  paletteHex.value = hex.toUpperCase();
  paletteHex.classList.remove("bad");
  drawPicker(hex);
}

function closePalette() {
  palette.hidden = true;
  document.querySelector(".swatch.open")?.classList.remove("open");
  activeColor = null;
}

function openPalette(input, swatch) {
  const wasOpen = activeColor === input;
  closePalette();
  if (wasOpen) return;
  activeColor = input;
  swatch.classList.add("open");
  palette.hidden = false;
  loadHex(input.value);
  const r = swatch.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.right - palette.offsetWidth), window.innerWidth - palette.offsetWidth - 8);
  let top = r.bottom + 6;
  if (top + palette.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - palette.offsetHeight - 6);
  palette.style.left = `${left}px`;
  palette.style.top = `${top}px`;
}

function track(el, onMove) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      onMove(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
    };
    move(e);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

track(sv, (x, y) => {
  hsv = [hsv[0], x, 1 - y];
  commitHsv();
});
track(hue, (x) => {
  hsv = [Math.min(359.9, x * 360), hsv[1], hsv[2]];
  commitHsv();
});

sv.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 0.1 : 0.02;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (!moves[e.key]) return;
  e.preventDefault();
  hsv = [hsv[0], clamp01(hsv[1] + moves[e.key][0]), clamp01(hsv[2] + moves[e.key][1])];
  commitHsv();
});
hue.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 30 : 5;
  const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
  if (d === undefined) return;
  e.preventDefault();
  hsv = [(hsv[0] + d + 360) % 360, hsv[1], hsv[2]];
  commitHsv();
});

for (const color of PRESETS) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.dataset.color = color;
  chip.title = color.toUpperCase();
  chip.style.setProperty("--c", color);
  chip.addEventListener("click", () => commit(color));
  $("palette-grid").append(chip);
}

paletteHex.addEventListener("input", () => {
  let v = paletteHex.value.trim();
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  const ok = /^#[0-9a-f]{6}$/i.test(v);
  paletteHex.classList.toggle("bad", !ok);
  if (ok) commit(v.toLowerCase(), { updateField: false });
});

for (const input of form.querySelectorAll('input[type="color"]')) {
  const field = document.createElement("span");
  field.className = "color-field";
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "swatch";
  swatch.setAttribute("aria-label", "Choose color");
  const hex = document.createElement("span");
  hex.className = "hex";
  input.before(field);
  input.classList.add("native-color");
  input.tabIndex = -1;
  field.append(input, swatch, hex);
  swatch.addEventListener("click", () => openPalette(input, swatch));
}

document.addEventListener("pointerdown", (e) => {
  if (!palette.hidden && !palette.contains(e.target) && !e.target.closest(".swatch")) closePalette();
});
document.querySelector("main").addEventListener("scroll", closePalette);
window.addEventListener("resize", closePalette);

form.addEventListener("input", () => {
  refresh();
  arc.previewLook(read());
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await arc.saveSettings(read());
  if (!res?.ok) return showError(res?.error ?? "Could not save");
  saved = res.settings;
  window.close();
});

function cancel() {
  arc.revertLook();
  window.close();
}
$("btn-cancel").addEventListener("click", cancel);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!palette.hidden) return closePalette();
  cancel();
});

$("btn-reset").addEventListener("click", () => {
  fill(lookDefaults);
  arc.previewLook(read());
  showError("Default look restored. Press Save to keep it.", "hint");
});

$("btn-quit").addEventListener("click", () => arc.quit());

function showLinkCode(code) {
  const tiles = $("code-tiles");
  tiles.replaceChildren();
  for (const ch of code) {
    const tile = document.createElement("div");
    tile.className = "code-tile";
    tile.textContent = ch;
    tiles.append(tile);
  }
  $("link-code").hidden = !code;
}

function renderAccount() {
  $("account-linked").hidden = !auth.linked;
  $("account-unlinked").hidden = auth.linked;
  $("account-name").textContent = auth.name ?? "";
  $("btn-link-text").textContent = linking ? "Waiting for Steam · click to cancel" : "Link Steam account";
  if (!linking || auth.linked) showLinkCode("");
}

$("btn-link").addEventListener("click", async () => {
  if (linking) return arc.authCancel();
  linking = true;
  renderAccount();
  showError("Opening Steam in your browser…", "hint");
  const res = await arc.linkSteam();
  linking = false;
  renderAccount();
  showError(res?.ok ? `Linked as ${res.name}.` : (res?.error ?? "Could not link"), Boolean(res?.ok));
});

$("btn-unlink").addEventListener("click", async () => {
  await arc.unlinkSteam();
  showError("Steam account unlinked.", true);
});

const CODE_KEYS = {
  Space: "Space", Enter: "Enter", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
};

function toAccelerator(e) {
  let key = null;
  let needsModifier = false;
  if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (/^Key[A-Z]$/.test(e.code)) { key = e.code.slice(3); needsModifier = true; }
  else if (/^Digit\d$/.test(e.code)) { key = e.code.slice(5); needsModifier = true; }
  else if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
  else if (CODE_KEYS[e.code]) { key = CODE_KEYS[e.code]; needsModifier = e.code === "Space" || e.code === "Enter"; }
  if (!key) return {};

  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (needsModifier && !mods.length) {
    return { error: "Letters, digits, Space and Enter need Ctrl, Alt or Shift, otherwise they'd stop working in the game." };
  }
  return { accelerator: [...mods, key].join("+") };
}

for (const field of form.querySelectorAll("input.hotkey")) {
  let previous = "";
  field.addEventListener("focus", () => {
    previous = field.value;
    field.value = "Press keys…";
    field.classList.add("recording");
  });
  field.addEventListener("blur", () => {
    if (field.value === "Press keys…") field.value = previous;
    field.classList.remove("recording");
  });
  field.addEventListener("keydown", (e) => {
    e.preventDefault();
    if (e.key === "Escape") return field.blur();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const { accelerator, error } = toAccelerator(e);
    if (error) showError(error);
    if (!accelerator) return;
    showError("");
    field.value = accelerator;
    previous = accelerator;
    field.blur();
  });
}

function renderMuted(muted = []) {
  const box = $("muted-list");
  if (!muted.length) {
    const none = document.createElement("p");
    none.className = "note";
    none.textContent = "You haven't muted anyone.";
    return box.replaceChildren(none);
  }
  box.replaceChildren(...muted.map((p) => {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "label";
    name.textContent = p.name || p.id;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "line-btn";
    undo.textContent = "Unmute";
    undo.addEventListener("click", () => arc.unmutePlayer(p.id));
    row.append(name, undo);
    return row;
  }));
}
arc.onSettings((s) => renderMuted(s.mutedPlayers));

arc.onConnection((c) => { status.connection = c; renderStatus(); });
arc.onRoom((r) => { status.room = r; renderStatus(); });
arc.onWatcher((w) => { status.watcher = w; renderStatus(); });
arc.onAuth((a) => { auth = a; renderAccount(); });
arc.onLinkCode((code) => {
  showLinkCode(code ?? "");
  if (code) showError("");
});

(async () => {
  const state = await arc.getState();
  saved = state.settings;
  lookDefaults = state.lookDefaults;
  status = { connection: state.connection, room: state.room, watcher: state.watcher };
  auth = state.auth;
  fill(saved);
  renderMuted(saved.mutedPlayers);
  renderAccount();
  renderStatus();
  showTab("account");
  if (state.firstRun) showError("Link your Steam account to start chatting.", "hint");
})();
