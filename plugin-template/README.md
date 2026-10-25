# ARC Chat plugin template

A starting point for an [ARC Chat](https://github.com/JaysonPasquier/ARC-Chat) plugin. It uses every part of the plugin API, so keep what you need and delete the rest.

| File | What it does |
|---|---|
| `plugin.json` | Name, permissions and pages of the plugin |
| `plugin.js` | Runs in the background: reacts to messages, adds `/hello`, turns "gg" into "GG 🎉" |
| `panel.html`, `panel.js` | A small bar in the chat window showing the current match |
| `settings.html`, `settings.js` | A page in ARC Chat's settings with a counter and a button |
| `style.css` | Styles for both pages |

## Get started

1. Change `id`, `name`, `author` and `description` in `plugin.json`. The `id` must be unique: lowercase letters, digits and dashes.
2. Remove the permissions you don't use, and the `overlay` / `settings` entries if you don't need those pages.
3. In ARC Chat: **Settings → Plugins → From a folder on this PC**, pick this folder and install it.
4. Edit the files, then install the folder again to see your changes.

The full API is described in [docs/PLUGINS.md](https://github.com/JaysonPasquier/ARC-Chat/blob/main/docs/PLUGINS.md).

## Rules worth knowing

- Pages can't run inline scripts: put your code in `.js` files and load `/__sdk.js` first.
- `fetch` and images only work for hosts listed in `network` (HTTPS only).
- Text you return from a command or `arc.print()` is shown only to the player using the plugin.

## Share it

Put the plugin in a GitHub repository with `plugin.json` at the root and publish a release. Players install it by typing `your-name/my-plugin` in **Settings → Plugins**.
