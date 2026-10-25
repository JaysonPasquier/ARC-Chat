const room = document.getElementById("room");
const show = (code) => (room.textContent = code ? `Match ${code}` : "Lobby");

arc.on("ready", () => show(arc.room));
arc.on("room", show);
