# Building and shipping the installer

Working product name: **ARC Chat** (change `productName` / `appId` in `overlay/package.json` > `build` if you pick another name).

## Build (on Windows, from `overlay/`)

```
npm install
python -m pip install pyinstaller mss pillow winsdk
npm run dist
```

- `npm run build:watcher` freezes `arc_watcher.py` with PyInstaller into `overlay/build/watcher-dist/arc-watcher/` (no Python needed on the player's PC).
- `npm run dist:app` packs the overlay and that folder into `overlay/dist/ARC-Chat-Setup-<version>.exe` (NSIS, per-user, no admin rights).
- Bump `version` in `overlay/package.json` for every release.
- Quick check of the frozen watcher: `overlay/build/watcher-dist/arc-watcher/arc-watcher.exe --selftest` must print `"ok": true`.

The installed app runs the bundled `arc-watcher.exe`; `npm start` from source still uses `python arc_watcher.py`.
The server address comes from `overlay/server-url.js` (live: `https://api.web-and-live.com`).

## Tested (this machine)

Silent install to a temp folder, launch with an isolated profile, bundled watcher process started from the install folder, silent uninstall left no folder, registry entry or shortcut.

## Known limits

- **The installer is not code-signed.** Windows SmartScreen shows "Windows protected your PC" until the file has downloads/reputation or you buy a code-signing certificate. Players click "More info" then "Run anyway". Say so on the download page.
- The installer is about 130 MB (Electron + the Windows OCR runtime). Download it from your site or Nexus Mods rather than emailing it.
- No auto-update yet (electron-updater can be added later).
- Not yet tested on a second, clean machine or a French/other-language Windows OCR pack: the watcher uses the Windows OCR engine of the user's profile languages.

## Before announcing

1. The live server runs the new code (reports, moderation) and `ADMIN_TOKEN` is set. See `docs/LIVE_SERVER.md`.
2. Ask Embark about the overlay (it never touches the game: it only reads the screen like any capture tool).
3. Publish `ARC-Chat-Setup-<version>.exe` and its SHA-256 (`Get-FileHash`).
