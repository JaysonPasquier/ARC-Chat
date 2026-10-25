(function (root) {
  const COMMAND_RE = /^[a-z][a-z0-9-]{1,19}$/;
  const MAX_SEGMENTS = 100;

  function createPluginHost({ print, builtIn = [], onCommands = () => {} }) {
    const frames = new Map();
    const renderers = [];
    const commands = new Map();
    const waiting = new Map();
    const lastSend = new Map();
    const lastPrint = new Map();
    let context = { room: null, selfId: null };
    let seq = 0;

    const has = (plugin, perm) => plugin.permissions.includes(perm);
    const to = (win, msg) => win.postMessage(msg, "*");

    function add(plugin, page, kind, container, height) {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      f.className = `plugin-frame plugin-${kind}`;
      f.title = plugin.name;
      if (height) f.style.height = `${height}px`;
      f.src = `arc-plugin://${plugin.id}/${page}`;
      container.append(f);
      frames.set(f.contentWindow, { plugin, kind, el: f });
      return f;
    }

    function clear() {
      for (const { el } of frames.values()) el.remove();
      frames.clear();
      renderers.length = 0;
      commands.clear();
      onCommands();
    }

    function ask(win, msg, timeout) {
      return new Promise((resolve) => {
        const reqId = `h${++seq}`;
        waiting.set(reqId, resolve);
        to(win, { ...msg, reqId });
        setTimeout(() => waiting.delete(reqId) && resolve(null), timeout);
      });
    }

    function emit(event, data, perm) {
      if (event === "room" || event === "joined") context = event === "room" ? { ...context, room: data } : { room: data.room, selfId: data.selfId };
      for (const [win, { plugin }] of frames) if (!perm || has(plugin, perm)) to(win, { type: "event", event, data });
    }

    function nodes(plugin, segments) {
      const out = [];
      let chars = 0;
      for (const seg of segments.slice(0, MAX_SEGMENTS)) {
        if (seg && typeof seg.text === "string") {
          chars += seg.text.length;
          if (chars > 2000) break;
          out.push(document.createTextNode(seg.text));
        } else if (seg && typeof seg.image === "string") {
          let url;
          try {
            url = new URL(seg.image);
          } catch {
            continue;
          }
          if (url.protocol !== "https:" || !plugin.network.includes(url.hostname)) continue;
          const img = document.createElement("img");
          img.className = "plugin-img";
          img.src = url.href;
          img.alt = typeof seg.alt === "string" ? seg.alt.slice(0, 60) : "";
          img.title = img.alt;
          img.referrerPolicy = "no-referrer";
          out.push(img);
        }
      }
      return out;
    }

    async function render(message) {
      for (const win of renderers) {
        const entry = frames.get(win);
        if (!entry) continue;
        const res = await ask(win, { type: "render", text: message.text, message }, 500);
        if (Array.isArray(res?.segments)) return nodes(entry.plugin, res.segments);
      }
      return null;
    }

    async function run(name, args) {
      const cmd = commands.get(name);
      if (!cmd) return false;
      const res = await ask(cmd.win, { type: "command", name, args }, 10000);
      if (res?.text) print(`[${cmd.plugin.name}] ${res.text}`);
      return true;
    }

    function limited(map, id, ms) {
      const now = Date.now();
      if (now - (map.get(id) ?? 0) < ms) return true;
      map.set(id, now);
      return false;
    }

    window.addEventListener("message", async (e) => {
      const entry = frames.get(e.source);
      const m = e.data;
      if (!entry || !m || typeof m !== "object" || typeof m.type !== "string") return;
      const { plugin, kind } = entry;
      const reply = (ok, value) => to(e.source, { type: "reply", reqId: m.reqId, ok, value: ok ? value : undefined, error: ok ? undefined : value });

      switch (m.type) {
        case "ready":
          return to(e.source, { type: "init", room: context.room, selfId: context.selfId, plugin: { id: plugin.id, version: plugin.version } });
        case "render:result":
        case "command:result": {
          const resolve = typeof m.reqId === "string" ? waiting.get(m.reqId) : undefined;
          if (typeof resolve === "function") {
            waiting.delete(m.reqId);
            resolve(m);
          }
          return;
        }
        case "render:enable":
          if (kind === "main" && has(plugin, "chat:render") && !renderers.includes(e.source)) renderers.push(e.source);
          return;
        case "command:register": {
          const name = String(m.name ?? "").toLowerCase();
          if (kind !== "main" || !has(plugin, "commands") || !COMMAND_RE.test(name) || builtIn.includes(name) || commands.has(name)) return;
          commands.set(name, { plugin, win: e.source, usage: String(m.usage ?? `/${name}`).slice(0, 60), help: String(m.help ?? "").slice(0, 100) });
          return onCommands();
        }
        case "send":
          if (!has(plugin, "chat:send")) return reply(false, "missing permission chat:send");
          if (typeof m.text !== "string" || !m.text.trim()) return reply(false, "empty message");
          if (limited(lastSend, plugin.id, 3000)) return reply(false, "slow down");
          {
            const res = await root.arc.sendMessage(m.text.slice(0, 300));
            return res?.ok ? reply(true, true) : reply(false, res?.error ?? "not sent");
          }
        case "system":
          if (typeof m.text === "string" && m.text.trim() && !limited(lastPrint, plugin.id, 500)) print(`[${plugin.name}] ${m.text.slice(0, 300)}`);
          return;
        case "storage:get":
        case "storage:set": {
          const res = m.type === "storage:get" ? await root.arc.pluginStorageGet(plugin.id, m.key) : await root.arc.pluginStorageSet(plugin.id, m.key, m.value);
          return res?.ok ? reply(true, res.value ?? null) : reply(false, res?.error ?? "refused");
        }
      }
    });

    return {
      add,
      clear,
      emit,
      render,
      run,
      hasRenderers: () => renderers.length > 0,
      commands: () => [...commands].map(([name, c]) => ({ name, usage: c.usage, help: c.help, plugin: c.plugin.name })),
    };
  }

  root.ArcPluginHost = { createPluginHost };
})(window);
