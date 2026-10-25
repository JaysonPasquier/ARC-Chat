<div align="center">

<img src="overlay/build/icon.png" width="120" alt="ARC Chat icon">

# ARC Chat

**A text chat for ARC Raiders. One room per match, right on top of your game.**

[![Download](https://img.shields.io/badge/Download-latest%20release-f6c21b?style=for-the-badge&logo=windows&logoColor=black)](https://github.com/JaysonPasquier/ARC-Chat/releases/latest)

[![Release](https://img.shields.io/github/v/release/JaysonPasquier/ARC-Chat?color=24d36e&label=release)](https://github.com/JaysonPasquier/ARC-Chat/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/JaysonPasquier/ARC-Chat/total?color=3fe0e0)](https://github.com/JaysonPasquier/ARC-Chat/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-ee3b36)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-9a8cff)

</div>

---

## Download

1. Go to the **[latest release](https://github.com/JaysonPasquier/ARC-Chat/releases/latest)** and download `ARC-Chat-Setup-x.y.z.exe`.
2. Run it. ARC Chat starts on its own.
3. Launch ARC Raiders. That's it.

There is nothing to configure: the app is already connected to the ARC Chat server. The first time, link your Steam account in the settings so people know who is talking.

> Windows may show *"Windows protected your PC"* because the installer isn't code-signed yet.
> Click **More info**, then **Run anyway**.
>
> Code signing for Windows releases is being set up with the [SignPath Foundation](https://signpath.org).

## How it works

| | |
|---|---|
| **Join a match** | The app reads the match code in the corner of the game window and puts you in that match's room. No code to share, no lobby to join. |
| **Leave a match** | Back to the lobby, you leave the room. Next match, new room. |
| **Never in your way** | The overlay is click-through. You can't click it by accident while playing. |

## Controls

| Key | Action |
|---|---|
| `F9` | Type a message (`Enter` to send, `Esc` to cancel) |
| `F10` | Move and resize the chat |

Both keys can be changed in the settings, along with colors, opacity, font size and how long old messages stay visible.

### Commands

| Command | |
|---|---|
| `/report <player> [reason]` | Report a player to the moderators |
| `/mute <player>` / `/unmute <player>` | Hide or show a player's messages, only for you |
| `/mutes` | List the players you muted |
| `/help` | Show the commands |

`Tab` completes player names.

## Plugins

Plugins add features to the chat: commands, images in messages, panels, settings pages. Install them from **Settings → Plugins**, from a folder or a GitHub repository. Each plugin shows what it wants to do before you install it, and runs in its own sandbox.

Want to make one? See [docs/PLUGINS.md](docs/PLUGINS.md).

## Safe by design

ARC Chat never touches the game. It takes screenshots of the game window, like any capture tool, and reads the match code with Windows' built-in text recognition. It doesn't read game memory, inject anything or send input to the game.

You sign in on Steam's own website. The app never sees your password. Messages are moderated automatically, and you can report or mute anyone. See the [privacy policy](PRIVACY.md) for what data is handled and why.

*ARC Chat is a fan project, not affiliated with or endorsed by Embark Studios. ARC Raiders is a trademark of its owners.*

## Run from source

Needs Node 22.9+ and Python 3.12 on Windows.

```
cd overlay
npm install
pip install mss pillow winsdk
npm start
```

To build the installer yourself, see [docs/RELEASE.md](docs/RELEASE.md).

## License

Released under the [GNU General Public License v3.0](LICENSE) © 2026 JaysonPasquier. You can read, modify and share the code, but any version you distribute must stay under the same license, with the source and the original copyright.
