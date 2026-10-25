const count = document.getElementById("count");

arc.on("ready", async () => {
  count.textContent = (await arc.storage.get("count")) ?? 0;
});

document.getElementById("reset").addEventListener("click", async () => {
  await arc.storage.set("count", 0);
  count.textContent = 0;
  arc.print("Counter reset");
});
