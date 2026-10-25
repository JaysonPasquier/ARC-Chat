(() => {
  const listeners = {};
  const commands = {};
  const pending = new Map();
  let renderer = null;
  let seq = 0;
  const post = (msg) => parent.postMessage(msg, "*");

  function request(msg) {
    return new Promise((resolve, reject) => {
      const reqId = ++seq;
      pending.set(reqId, { resolve, reject });
      post({ ...msg, reqId });
      setTimeout(() => pending.delete(reqId) && reject(new Error("timeout")), 10000);
    });
  }

  function emit(event, data) {
    for (const cb of listeners[event] ?? []) {
      try {
        cb(data);
      } catch (err) {
        console.error(err);
      }
    }
  }

  addEventListener("message", async (e) => {
    if (e.source !== parent || !e.data || typeof e.data !== "object") return;
    const m = e.data;
    if (m.type === "reply") {
      const p = pending.get(m.reqId);
      if (!p) return;
      pending.delete(m.reqId);
      return m.ok ? p.resolve(m.value) : p.reject(new Error(m.error ?? "refused"));
    }
    if (m.type === "init") {
      Object.assign(arc, { room: m.room, selfId: m.selfId });
      return emit("ready", m);
    }
    if (m.type === "render") {
      let segments = null;
      try {
        segments = renderer ? await renderer(m.text, m.message) : null;
      } catch (err) {
        console.error(err);
      }
      return post({ type: "render:result", reqId: m.reqId, segments: Array.isArray(segments) ? segments : null });
    }
    if (m.type === "command") {
      let out = null;
      try {
        out = await commands[m.name]?.(m.args);
      } catch (err) {
        out = `Error: ${err.message}`;
      }
      return post({ type: "command:result", reqId: m.reqId, text: typeof out === "string" ? out : null });
    }
    if (m.type === "event") {
      if (m.event === "room") arc.room = m.data;
      if (m.event === "joined") Object.assign(arc, { room: m.data.room, selfId: m.data.selfId });
      emit(m.event, m.data);
    }
  });

  const arc = {
    room: null,
    selfId: null,
    on(event, cb) {
      (listeners[event] ??= []).push(cb);
    },
    onRender(fn) {
      renderer = fn;
      post({ type: "render:enable" });
    },
    command(name, info, handler) {
      commands[name] = handler;
      post({ type: "command:register", name, usage: info?.usage ?? `/${name}`, help: info?.help ?? "" });
    },
    send: (text) => request({ type: "send", text }),
    print: (text) => post({ type: "system", text: String(text) }),
    storage: {
      get: (key) => request({ type: "storage:get", key }),
      set: (key, value) => request({ type: "storage:set", key, value }),
    },
  };

  window.arc = arc;
  addEventListener("load", () => post({ type: "ready" }));
})();
