# ARC Chat

A text chat overlay for ARC Raiders, with one chat room per match. Not affiliated with or endorsed by Embark Studios.

The app never touches the game. It takes screenshots of the game window like any capture tool, reads the match code shown in the bottom-right corner with Windows OCR, and joins the room for that code. The overlay is click-through, so you can't hit it by accident while playing.

## How it works

- `arc_watcher.py` finds the game window, reads the match code, and tells the overlay when you join a match or go back to the lobby.
- `overlay/` is the Electron chat window (transparent, always on top, click-through). `F9` to type, `F10` to move and resize.
- Chatting needs a linked Steam account. The sign-in happens on Steam's own website, the app never sees a password.
- The chat server is hosted separately and is not part of this repository. Messages are moderated automatically, and you can report players.

Chat commands: `/report <player> [reason]`, `/mute <player>`, `/unmute <player>`, `/mutes`, `/help`.

## Run from source

Needs Windows 10/11, Node 22.9+ and Python 3.12.

```
cd overlay
npm install
pip install mss pillow winsdk
npm start
```

`npm run local` connects to a server on `http://localhost:3000` instead, for development.

## Tests

```
cd overlay && node commands.test.js
```

## Building the installer

See `docs/RELEASE.md`.

## License

MIT
