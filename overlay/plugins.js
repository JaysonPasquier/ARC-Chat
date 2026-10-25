const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const AdmZip = require("adm-zip");

const PERMISSIONS = {
  "chat:read": "Read the messages of your match's chat",
  "chat:render": "Change how messages look in your chat (for example show images)",
  "chat:send": "Send messages in your name",
  commands: "Add chat commands",
  "ui:overlay": "Show a panel in the chat window",
  "ui:settings": "Add a page to the settings",
  storage: "Save its own data on your computer",
};

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const FILE_RE = /^[A-Za-z0-9_\-./]{1,200}$/;
const REPO_RE = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;
const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ZIP = 10 * 1024 * 1024;
const MAX_STORAGE = 256 * 1024;
const DOWNLOAD_HOSTS = new Set(["api.github.com", "github.com", "codeload.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");

function safeJoin(root, rel) {
  if (typeof rel !== "string" || !FILE_RE.test(rel) || rel.split("/").includes("..")) return null;
  const full = path.resolve(root, rel);
  return full.startsWith(path.resolve(root) + path.sep) ? full : null;
}

function readManifest(dir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8").replace(/^﻿/, ""));
  } catch {
    throw new Error("plugin.json is missing or is not valid JSON");
  }
  if (!raw || typeof raw !== "object") throw new Error("plugin.json is not an object");
  const id = String(raw.id ?? "");
  if (!ID_RE.test(id)) throw new Error("id must be 2-40 lowercase letters, digits or dashes");
  const name = text(raw.name, 40);
  if (!name) throw new Error("name is required");
  const permissions = [...new Set(Array.isArray(raw.permissions) ? raw.permissions : [])];
  const unknown = permissions.filter((p) => !(p in PERMISSIONS));
  if (unknown.length) throw new Error(`unknown permission: ${unknown.join(", ")}`);
  const network = [...new Set((Array.isArray(raw.network) ? raw.network : []).map((h) => String(h).toLowerCase()))];
  if (network.length > 10 || network.some((h) => !HOST_RE.test(h))) throw new Error("network must be a list of up to 10 host names, like api.example.com");

  const main = raw.main === undefined ? "plugin.js" : raw.main;
  if (!safeJoin(dir, main) || !main.endsWith(".js") || !fs.existsSync(safeJoin(dir, main))) throw new Error(`main file ${main} is missing`);

  const page = (key, perm) => {
    if (raw[key] === undefined) return null;
    if (!permissions.includes(perm)) throw new Error(`${key} needs the ${perm} permission`);
    const file = raw[key]?.page;
    if (!safeJoin(dir, file) || !file.endsWith(".html") || !fs.existsSync(safeJoin(dir, file))) throw new Error(`${key}.page is missing`);
    return file;
  };
  const overlayPage = page("overlay", "ui:overlay");
  const settingsPage = page("settings", "ui:settings");
  const height = Math.min(400, Math.max(40, Math.round(Number(raw.overlay?.height) || 120)));
  const homepage = typeof raw.homepage === "string" && /^https:\/\/[^\s]{1,300}$/.test(raw.homepage) ? raw.homepage : null;

  return {
    id,
    name,
    version: text(raw.version, 20) || "0.0.0",
    author: text(raw.author, 40),
    description: text(raw.description, 200),
    homepage,
    main,
    permissions,
    network,
    overlay: overlayPage ? { page: overlayPage, height } : null,
    settings: settingsPage ? { page: settingsPage } : null,
  };
}

function measure(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) throw new Error("plugins can't contain links");
      if (entry.isDirectory()) walk(full);
      else {
        files++;
        bytes += fs.statSync(full).size;
      }
      if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error("plugin is too big (500 files / 20 MB max)");
    }
  };
  walk(dir);
  return { files, bytes };
}

function findRoot(dir) {
  if (fs.existsSync(path.join(dir, "plugin.json"))) return dir;
  const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (dirs.length === 1 && fs.existsSync(path.join(dir, dirs[0].name, "plugin.json"))) return path.join(dir, dirs[0].name);
  throw new Error("no plugin.json found");
}

function extractZip(buffer, dest) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > MAX_FILES) throw new Error("plugin is too big (500 files max)");
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/");
    const target = path.resolve(dest, name);
    if (name.startsWith("/") || name.split("/").includes("..") || !target.startsWith(path.resolve(dest) + path.sep)) throw new Error("the archive contains unsafe paths");
    total += entry.header.size;
    if (total > MAX_BYTES) throw new Error("plugin is too big (20 MB max)");
    const data = entry.getData();
    total += Math.max(0, data.length - entry.header.size);
    if (total > MAX_BYTES || data.length > MAX_BYTES) throw new Error("plugin is too big (20 MB max)");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

async function download(url, maxBytes) {
  const res = await fetch(url, { headers: { "user-agent": "ARC-Chat", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20000) });
  if (!DOWNLOAD_HOSTS.has(new URL(res.url).hostname)) throw new Error("unexpected download location");
  if (!res.ok) throw new Error(res.status === 404 ? "repository or release not found" : `GitHub answered HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("download is too big");
  return buf;
}

function createPluginManager({ root, appDir, getState, setState }) {
  const dir = path.join(root, "plugins");
  const dataDir = path.join(root, "plugin-data");
  const staged = new Map();
  fs.mkdirSync(dir, { recursive: true });

  const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  function list() {
    const state = getState();
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(dir, entry.name);
      try {
        const manifest = readManifest(pluginDir);
        if (manifest.id !== entry.name) throw new Error("folder name doesn't match its id");
        const saved = state[manifest.id];
        const approved = Boolean(saved) && sameList(saved.granted, manifest.permissions) && sameList(saved.network, manifest.network);
        const status = !saved?.enabled ? "disabled" : approved ? "active" : "needs-approval";
        out.push({ ...manifest, status });
      } catch (err) {
        out.push({ id: entry.name, name: entry.name, status: "broken", error: err.message, permissions: [], network: [] });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const active = () => list().filter((p) => p.status === "active");
  const activeById = (id) => active().find((p) => p.id === id) ?? null;

  function stage(sourceDir, cleanup, source) {
    const pluginRoot = findRoot(sourceDir);
    const manifest = readManifest(pluginRoot);
    const size = measure(pluginRoot);
    const token = randomBytes(16).toString("hex");
    staged.set(token, { pluginRoot, manifest, cleanup, at: Date.now() });
    for (const [t, s] of staged) if (Date.now() - s.at > 10 * 60_000) discard(t);
    const installed = list().find((p) => p.id === manifest.id);
    return { token, manifest, size, source, replaces: installed?.version ?? null };
  }

  function discard(token) {
    const s = staged.get(token);
    staged.delete(token);
    s?.cleanup?.();
  }

  function stageFolder(folder) {
    return stage(folder, null, folder);
  }

  async function stageGitHub(input) {
    const m = REPO_RE.exec(String(input ?? "").trim());
    if (!m) throw new Error("use owner/repo or a github.com repository link");
    const [, owner, repo] = m;
    const release = JSON.parse((await download(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, 1024 * 1024)).toString("utf8"));
    const asset = (release.assets ?? []).find((a) => /\.zip$/i.test(a.name ?? ""));
    const url = asset?.browser_download_url ?? release.zipball_url;
    if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("the latest release has no zip");
    const zip = await download(url, MAX_ZIP);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-plugin-"));
    const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    try {
      extractZip(zip, tmp);
      return stage(tmp, cleanup, `github.com/${owner}/${repo} (${text(release.tag_name, 40) || "latest"})`);
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  function install(token) {
    const s = staged.get(token);
    if (!s) throw new Error("install expired, try again");
    const target = path.join(dir, s.manifest.id);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(s.pluginRoot, target, { recursive: true, dereference: false });
    discard(token);
    setState(s.manifest.id, { enabled: true, granted: s.manifest.permissions, network: s.manifest.network });
    return s.manifest;
  }

  function setEnabled(id, enabled) {
    const plugin = list().find((p) => p.id === id && p.status !== "broken");
    if (!plugin) throw new Error("plugin not found");
    setState(id, enabled ? { enabled: true, granted: plugin.permissions, network: plugin.network } : { ...getState()[id], enabled: false });
  }

  function remove(id) {
    if (!ID_RE.test(id)) throw new Error("plugin not found");
    fs.rmSync(path.join(dir, id), { recursive: true, force: true });
    fs.rmSync(path.join(dataDir, `${id}.json`), { force: true });
    setState(id, null);
  }

  function readData(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, `${id}.json`), "utf8"));
    } catch {
      return {};
    }
  }

  function storageGet(id, key) {
    if (!activeById(id)?.permissions.includes("storage")) throw new Error("no storage permission");
    return readData(id)[String(key)] ?? null;
  }

  function storageSet(id, key, value) {
    if (!activeById(id)?.permissions.includes("storage")) throw new Error("no storage permission");
    const data = readData(id);
    if (value === null || value === undefined) delete data[String(key)];
    else data[String(key).slice(0, 100)] = value;
    const json = JSON.stringify(data);
    if (json.length > MAX_STORAGE) throw new Error("storage is full (256 KB)");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, `${id}.json`), json);
  }

  function csp(plugin) {
    const self = `arc-plugin://${plugin.id}`;
    const hosts = plugin.network.map((h) => `https://${h}`).join(" ");
    return [
      "default-src 'none'",
      `script-src ${self}`,
      `style-src ${self} 'unsafe-inline'`,
      `img-src ${self} data: ${hosts}`,
      `media-src ${self} ${hosts}`,
      `font-src ${self}`,
      `connect-src ${hosts || "'none'"}`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  }

  function serve(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const plugin = activeById(u.hostname);
    if (!plugin) return new Response("Not found", { status: 404 });
    const headers = { "content-security-policy": csp(plugin), "x-content-type-options": "nosniff", "cache-control": "no-store" };
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    if (rel === "__host.html") {
      return new Response(`<!doctype html><meta charset="utf-8"><script src="/__sdk.js"></script><script src="/${plugin.main}"></script>`, {
        headers: { ...headers, "content-type": MIME[".html"] },
      });
    }
    if (rel === "__sdk.js") {
      return new Response(fs.readFileSync(path.join(appDir, "plugin-sdk.js")), { headers: { ...headers, "content-type": MIME[".js"] } });
    }
    const file = safeJoin(path.join(dir, plugin.id), rel);
    const type = MIME[path.extname(rel).toLowerCase()];
    if (!file || !type) return new Response("Not found", { status: 404 });
    let body;
    try {
      const fd = fs.openSync(file, "r");
      try {
        if (!fs.fstatSync(fd).isFile()) return new Response("Not found", { status: 404 });
        body = fs.readFileSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return new Response(body, { headers: { ...headers, "content-type": type } });
  }

  return { list, active, stageFolder, stageGitHub, discard, install, setEnabled, remove, storageGet, storageSet, serve };
}

module.exports = { createPluginManager, readManifest, extractZip, PERMISSIONS };
