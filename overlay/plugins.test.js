const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { createPluginManager, readManifest, extractZip } = require("./plugins.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-plugins-test-"));
const write = (dir, files) => {
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
};
const manifest = (extra = {}) => ({ id: "demo", name: "Demo", version: "1.2.3", permissions: ["chat:read", "storage"], network: ["api.example.com"], ...extra });

(async () => {
  const good = write(path.join(tmp, "src"), { "plugin.json": manifest(), "plugin.js": "arc.on('ready',()=>{})", "img/a.png": "x" });
  assert.equal(readManifest(good).id, "demo");
  assert.equal(readManifest(path.join(__dirname, "..", "plugin-template")).id, "my-plugin", "the plugin template is valid");
  const bad = (m, re) => assert.throws(() => readManifest(write(fs.mkdtempSync(path.join(tmp, "b-")), { "plugin.json": m, "plugin.js": "" })), re);
  bad(manifest({ id: "Bad Id" }), /id must be/);
  bad(manifest({ permissions: ["root"] }), /unknown permission/);
  bad(manifest({ network: ["http://x.com"] }), /network/);
  bad(manifest({ main: "../evil.js" }), /main file/);
  bad(manifest({ overlay: { page: "panel.html" } }), /needs the ui:overlay permission/);
  bad("{not json", /not valid JSON/);

  let state = {};
  const pm = createPluginManager({
    root: path.join(tmp, "user"),
    appDir: __dirname,
    getState: () => state,
    setState: (id, v) => (v ? (state[id] = v) : delete state[id]),
  });
  const staged = pm.stageFolder(good);
  assert.equal(staged.manifest.name, "Demo");
  assert.equal(pm.list().length, 0, "nothing is installed before the user confirms");
  pm.install(staged.token);
  assert.equal(pm.list()[0].status, "active");
  assert.throws(() => pm.install(staged.token), /expired/);

  const page = await pm.serve("arc-plugin://demo/__host.html").text();
  assert.match(page, /__sdk\.js/);
  const res = pm.serve("arc-plugin://demo/img/a.png");
  assert.equal(res.status, 200);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /connect-src https:\/\/api\.example\.com/);
  assert.match(csp, /default-src 'none'/);
  assert.equal(pm.serve("arc-plugin://demo/../../../settings.json").status, 404);
  assert.equal(pm.serve("arc-plugin://demo/%2e%2e/%2e%2e/settings.json").status, 404);
  assert.equal(pm.serve("arc-plugin://demo/plugin.json.exe").status, 404);
  assert.equal(pm.serve("arc-plugin://other/plugin.js").status, 404);

  pm.storageSet("demo", "k", { a: 1 });
  assert.deepEqual(pm.storageGet("demo", "k"), { a: 1 });
  assert.throws(() => pm.storageSet("demo", "big", "x".repeat(300 * 1024)), /full/);

  write(path.join(tmp, "user", "plugins", "demo"), { "plugin.json": manifest({ permissions: ["chat:read", "storage", "chat:send"] }) });
  assert.equal(pm.list()[0].status, "needs-approval", "new permissions turn the plugin off until approved");
  assert.equal(pm.serve("arc-plugin://demo/plugin.js").status, 404);
  assert.throws(() => pm.storageGet("demo", "k"), /permission/);
  pm.setEnabled("demo", true);
  assert.equal(pm.list()[0].status, "active");
  pm.setEnabled("demo", false);
  assert.equal(pm.serve("arc-plugin://demo/plugin.js").status, 404, "disabled plugins are not served");

  const slip = new AdmZip();
  slip.addFile("ok.txt", Buffer.from("ok"));
  slip.getEntries()[0].entryName = "../../escape.txt";
  assert.throws(() => extractZip(slip.toBuffer(), fs.mkdtempSync(path.join(tmp, "z-"))), /unsafe paths/);
  const nested = new AdmZip();
  nested.addFile("demo-main/plugin.json", Buffer.from(JSON.stringify(manifest({ id: "nested" }))));
  nested.addFile("demo-main/plugin.js", Buffer.from(""));
  const out = fs.mkdtempSync(path.join(tmp, "z-"));
  extractZip(nested.toBuffer(), out);
  assert.equal(pm.stageFolder(out).manifest.id, "nested", "a release zip with one top folder works");

  pm.remove("demo");
  assert.equal(pm.list().length, 0);
  assert.equal(state.demo, undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("plugins: all checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
