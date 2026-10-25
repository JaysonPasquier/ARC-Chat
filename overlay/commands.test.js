const assert = require("node:assert/strict");
const { parse, resolvePlayer, suggest } = require("./commands.js");

const players = [
  { id: "steam:" + "a".repeat(20), name: "Bob" },
  { id: "steam:" + "b".repeat(20), name: "Bobby Tables" },
  { id: "steam:" + "c".repeat(20), name: "Alice" },
];

assert.equal(parse("hello"), null);
assert.deepEqual(parse("/Report Bob  spam "), { name: "report", args: "Bob  spam" });
assert.deepEqual(parse("/mutes"), { name: "mutes", args: "" });

assert.equal(resolvePlayer("bob spam here", players).player.name, "Bob");
assert.equal(resolvePlayer("bob spam here", players).rest, "spam here");
assert.equal(resolvePlayer("Bobby Tables rude", players).player.name, "Bobby Tables");
assert.equal(resolvePlayer("Bobby Tables rude", players).rest, "rude");
assert.equal(resolvePlayer("ali", players).player.name, "Alice");
assert.match(resolvePlayer("bo", players).error, /Several players/);
assert.match(resolvePlayer("zed", players).error, /No player/);
assert.match(resolvePlayer("", players).error, /which player/);

assert.deepEqual(suggest("/m", players), ["/mute ", "/mutes "]);
assert.deepEqual(suggest("/mute b", players), ["/mute Bob ", "/mute Bobby Tables "]);
assert.deepEqual(suggest("/mute Bob reason", players), []);
assert.deepEqual(suggest("hi", players), []);
console.log("commands: all checks passed");
