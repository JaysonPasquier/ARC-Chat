(function (root) {
  const COMMANDS = {
    report: { usage: "/report <player> [reason]", help: "Report a player to the moderators" },
    mute: { usage: "/mute <player>", help: "Hide a player's messages (only for you)" },
    unmute: { usage: "/unmute <player>", help: "Show a muted player again" },
    mutes: { usage: "/mutes", help: "List the players you muted" },
    help: { usage: "/help", help: "Show these commands" },
  };

  const norm = (s) => String(s).normalize("NFKC").toLowerCase();

  function parse(text) {
    const m = /^\/(\S*)\s*(.*)$/s.exec(text.trim());
    if (!m) return null;
    return { name: m[1].toLowerCase(), args: m[2].trim() };
  }

  // Names can contain spaces, so the longest known name at the start of the arguments wins; otherwise the first
  // word may be an unambiguous prefix ("/mute bo" for "Bob").
  function resolvePlayer(args, players) {
    const q = norm(args);
    if (!q) return { error: "Tell me which player." };
    let best = null;
    for (const p of players) {
      const n = norm(p.name);
      if ((q === n || q.startsWith(n + " ")) && (!best || n.length > norm(best.name).length)) best = p;
    }
    if (best) return { player: best, rest: args.slice(best.name.length).trim() };
    const first = q.split(/\s+/)[0];
    const hits = players.filter((p) => norm(p.name).startsWith(first));
    if (hits.length === 1) return { player: hits[0], rest: args.slice(first.length).trim() };
    if (hits.length > 1) return { error: `Several players match "${first}": ${hits.map((p) => p.name).join(", ")}.` };
    return { error: `No player called "${args.split(/\s+/)[0]}" has spoken in this match.` };
  }

  function suggest(text, players) {
    if (!text.startsWith("/")) return [];
    const space = text.indexOf(" ");
    if (space === -1) {
      const typed = text.slice(1).toLowerCase();
      return Object.keys(COMMANDS).filter((c) => c.startsWith(typed)).map((c) => `/${c} `);
    }
    const cmd = text.slice(1, space).toLowerCase();
    if (!["report", "mute", "unmute"].includes(cmd)) return [];
    const partial = norm(text.slice(space + 1));
    if (/\s/.test(partial.trim())) return [];
    return players.filter((p) => norm(p.name).startsWith(partial)).map((p) => `/${cmd} ${p.name} `);
  }

  const api = { COMMANDS, parse, resolvePlayer, suggest };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ArcCommands = api;
})(typeof window !== "undefined" ? window : globalThis);
