# eTty

Terminal wrapper application built with Electron, xterm.js, and node-pty.

## Tech Stack

- **Electron 33** — desktop app shell
- **electron-vite** — build tooling
- **xterm.js** — terminal rendering (+ addons: fit, webgl, web-links, search)
- **node-pty** — pseudo-terminal backend
- **electron-builder** — packaging and distribution

## Development

```bash
npm install
npm run dev
```

## Building a distributable

### Prerequisites

- macOS (for `.dmg`)
- Node.js 18+
- Xcode Command Line Tools (for native module rebuild): `xcode-select --install`

### Steps

```bash
# 1. Compile with electron-vite
npm run build

# 2. Package with electron-builder
npm run dist          # macOS .dmg (arm64 + x64)
npm run dist:win      # Windows NSIS installer (run on Windows)
npm run dist:linux    # Linux AppImage + .deb (run on Linux)
```

Output artifacts are placed in `dist/`.

### Code signing (macOS)

Without certificates the app is signed ad-hoc — fine for local testing.  
For a signed and notarized release, set these environment variables before running `npm run dist`:

| Variable | Description |
|----------|-------------|
| `CSC_LINK` | Path to `.p12` certificate or base64-encoded string |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (generate at appleid.apple.com) |
| `APPLE_TEAM_ID` | 10-character Team ID from developer.apple.com |

```bash
export CSC_LINK=/path/to/certificate.p12
export CSC_KEY_PASSWORD=...
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
npm run build && npm run dist
```

### Verify signing

```bash
# Check signature
codesign -dv --verbose=4 dist/mac-arm64/eTty.app

# Check notarization (only after proper signing with Developer ID)
spctl -a -vvv -t install dist/mac-arm64/eTty.app
```

### Notes

- `node-pty` is a native module. electron-builder rebuilds it automatically for the target Electron version via `"npmRebuild": true` in `package.json`.
- `build/entitlements.mac.plist` contains required entitlements for `node-pty` under hardened runtime.
- Auto-update is stubbed (logs only). Full implementation is a separate feature.

## Stage 1: Базовая обёртка терминала

| Task | Status |
|------|--------|
| Task 1: Инициализация проекта | Done |
| Task 2: PTY Manager | Done |
| Task 3: Main Process | Done |
| Task 4: Preload Script | Done |
| Task 5: Renderer — HTML и CSS | Done |
| Task 6: Renderer — логика терминала | Done |
| Task 7: Первый запуск и верификация | Done |

## Stage 2: Расширение UI

| Task | Status |
|------|--------|
| Sidebar file tree | Done |
| Multi-tab support | Done |
| App packaging (electron-builder) | Done |
