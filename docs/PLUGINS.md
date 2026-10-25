# Making a plugin

A plugin adds features to ARC Chat: new chat commands, images in messages, a panel in the chat window, a settings page, and more. Players install plugins from the **Plugins** tab of the settings, from a folder or from a GitHub repository.

Plugins run in their own sandbox. They can only do what their `plugin.json` asks for and the player accepted. They never get the player's Steam session, files, the match code reader or the game.

## Start from the template

**[Download the plugin template](https://github.com/JaysonPasquier/ARC-Chat/releases/latest/download/arc-chat-plugin-template.zip)**, or copy the [`plugin-template`](../plugin-template) folder. It uses every part of the API, so keep what you need and delete the rest.

## Files

```
my-plugin/
  plugin.json     required
  plugin.js       runs in the background while the plugin is on
  panel.html      optional, shown in the chat window
  settings.html   optional, shown in the settings
```

## plugin.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "description": "One sentence about what it does.",
  "homepage": "https://github.com/you/my-plugin",
  "main": "plugin.js",
  "permissions": ["chat:read", "commands"],
  "network": ["api.example.com"],
  "overlay": { "page": "panel.html", "height": 120 },
  "settings": { "page": "settings.html" }
}
```

| Field | |
|---|---|
| `id` | 2-40 lowercase letters, digits or dashes. Must be unique, it's also the folder name. |
| `name`, `version`, `author`, `description` | Shown to the player before installing. |
| `main` | Background script, `plugin.js` by default. |
| `permissions` | What the plugin may do, see below. Ask only for what you use. |
| `network` | Up to 10 host names the plugin may load images from or `fetch` (HTTPS only). Anything else is blocked. |
| `overlay` | A page shown above the messages in the chat window, 40-400 px high. Needs `ui:overlay`. |
| `settings` | A page opened from the plugin's **Settings** button. Needs `ui:settings`. |

If an update asks for new permissions or hosts, the plugin is turned off until the player accepts them again.

## Permissions

| Permission | Lets the plugin |
|---|---|
| `chat:read` | Receive the messages of the player's match |
| `chat:render` | Change how a message is displayed (text and images) |
| `chat:send` | Send messages as the player (once every 3 seconds at most, and the server still moderates them) |
| `commands` | Add `/commands` |
| `ui:overlay` | Show its `overlay` page in the chat window |
| `ui:settings` | Show its `settings` page in the settings |
| `storage` | Save up to 256 KB of its own data |

## API

Every page gets a global `arc` object. `plugin.js` has it automatically. In your HTML pages, load it first:

```html
<script src="/__sdk.js"></script>
```

```js
arc.on("ready", ({ room, selfId }) => {});          // the plugin is connected
arc.on("joined", ({ room, selfId }) => {});         // the player joined a match
arc.on("room", (room) => {});                       // match code, or null in the lobby
arc.on("message", ({ user, text, ts, self }) => {}); // chat:read

arc.command("roll", { usage: "/roll [sides]", help: "Roll a die" }, (args) => {
  return `rolled ${1 + Math.floor(Math.random() * (Number(args) || 6))}`; // shown to the player only
});

arc.onRender((text, message) => {                   // chat:render
  if (!text.includes(":wave:")) return null;        // null = leave the message as it is
  return [{ text: "hello " }, { image: "https://api.example.com/wave.png", alt: "wave" }];
});

await arc.send("gg");                               // chat:send
arc.print("Saved!");                                // a local info line for the player
await arc.storage.set("theme", "dark");             // storage
const theme = await arc.storage.get("theme");
```

- `arc.room` and `arc.selfId` hold the current match code and the player's chat id.
- Images in `onRender` must be HTTPS and come from a host listed in `network`.
- If several plugins change the same message, only the first answer is used.
- Commands can't replace the built-in ones (`/report`, `/mute`, `/unmute`, `/mutes`, `/help`).

## Trying it

1. Put your files in a folder.
2. In ARC Chat: **Settings → Plugins → From a folder on this PC**, pick the folder, check the permissions and press **Install**.
3. After a change, install the folder again to update it.

Use `arc.print()` to show debug lines in the chat while you work on it.

## Publishing

Make a GitHub repository with `plugin.json` at its root, and publish a release. Attach a `.zip` of the plugin if you want, otherwise the release's source zip is used. Players install it with `owner/repo` in **Settings → Plugins**.

## Features that need the server

Plugins run on the player's computer. Anything that needs the chat server to change, like private messages, can't be done by a plugin alone. Open an issue to suggest it.
