const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel) => (callback) => {
  ipcRenderer.on(channel, (_e, data) => callback(data));
};

contextBridge.exposeInMainWorld("arc", {
  getState: () => ipcRenderer.invoke("get-state"),
  sendMessage: (text) => ipcRenderer.invoke("send-message", text),
  reportPlayer: (userId, reason) => ipcRenderer.invoke("report-player", userId, reason),
  mutePlayer: (player) => ipcRenderer.invoke("mute-player", player),
  unmutePlayer: (userId) => ipcRenderer.invoke("unmute-player", userId),
  saveSettings: (patch) => ipcRenderer.invoke("save-settings", patch),
  previewLook: (patch) => ipcRenderer.send("preview-look", patch),
  revertLook: () => ipcRenderer.send("revert-look"),
  openSettings: () => ipcRenderer.send("open-settings"),
  linkSteam: () => ipcRenderer.invoke("auth-link-steam"),
  unlinkSteam: () => ipcRenderer.invoke("auth-unlink"),
  authCancel: () => ipcRenderer.send("auth-cancel"),
  setMode: (mode) => ipcRenderer.send("set-mode", mode),
  resizeStart: () => ipcRenderer.send("resize-start"),
  resizeMove: (dx, dy) => ipcRenderer.send("resize-move", dx, dy),
  resizeEnd: () => ipcRenderer.send("resize-end"),
  moveStart: () => ipcRenderer.send("move-start"),
  moveBy: (dx, dy) => ipcRenderer.send("move-by", dx, dy),
  moveEnd: () => ipcRenderer.send("move-end"),
  quit: () => ipcRenderer.send("quit"),
  onMode: listen("mode"),
  onSettings: listen("settings"),
  onRoom: listen("room"),
  onJoined: listen("joined"),
  onLeft: listen("left"),
  onAuth: listen("auth"),
  onLinkCode: listen("link-code"),
  onMessage: listen("message"),
  onPresence: listen("presence"),
  onConnection: listen("connection"),
  onWatcher: listen("watcher"),
  onSystem: listen("system"),
});
