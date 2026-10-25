let count = 0;

arc.on("ready", async () => {
  count = (await arc.storage.get("count")) ?? 0;
  arc.print("My Plugin is running. Type /hello");
});

arc.on("joined", ({ room }) => {
  if (room) arc.print(`Joined ${room}`);
});

arc.on("message", async (message) => {
  if (message.self) return;
  count++;
  await arc.storage.set("count", count);
});

arc.command("hello", { usage: "/hello [name]", help: "Say hello (only you see it)" }, (args) => {
  return `Hello ${args || "raider"}! ${count} messages seen so far.`;
});

arc.onRender((text) => {
  const parts = text.split(/\bgg\b/i);
  if (parts.length === 1) return null;
  return parts.flatMap((part, i) => (i ? [{ text: "GG 🎉" }, { text: part }] : [{ text: part }]));
});
