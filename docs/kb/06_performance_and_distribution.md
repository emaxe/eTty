# Оптимизация производительности и сборка приложения

## Производительность рендеринга

| Проблема | Решение |
|----------|---------|
| Медленная прокрутка при большом объёме вывода | Включить `@xterm/addon-webgl`. Увеличивает FPS до 60 |
| Задержка при вводе | Избегать синхронных IPC вызовов. Использовать `ipcRenderer.send` (без ответа) |
| Память растёт из-за буфера прокрутки | Ограничить `scrollback: 10000` строк (по умолчанию 1000) |
| Мигание курсора грузит CPU | Установить `cursorBlink: false` или увеличить интервал |

## Отключение неиспользуемых функций

```javascript
// xterm.js
const term = new Terminal({
  disableStdin: false, // не отключать
  rendererType: 'webgl', // или 'canvas'
  allowTransparency: false,
  fastScrollModifier: 'alt',
  fastScrollSensitivity: 5,
});
```

## Профилирование

- Electron: `--enable-logging` для просмотра логов.
- Chrome DevTools в окне Electron (Ctrl+Shift+I).
- `process.memoryUsage()` в main и renderer.

## Сборка дистрибутива

### Использование electron-builder

```bash
npm install --save-dev electron-builder
```

`package.json`:

```json
{
  "build": {
    "appId": "com.example.myterminal",
    "productName": "MyTerminal",
    "directories": { "output": "dist" },
    "files": [
      "main.js",
      "renderer.js",
      "index.html",
      "node_modules/**/*"
    ],
    "extraResources": [
      {
        "from": "node_modules/node-pty/build/Release",
        "to": "node_modules/node-pty/build/Release",
        "filter": ["*.node"]
      }
    ],
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  }
}
```

### Упаковка нативных модулей

`electron-builder` автоматически копирует `.node` файлы, но может потребоваться настройка:

```json
"build": {
  "nodeModules": [
    "node-pty"
  ],
  "npmRebuild": true
}
```

### Подпись кода (macOS/Windows)

```bash
# macOS
export CSC_IDENTITY_AUTO_DISCOVERY=true
electron-builder --mac

# Windows (требуется сертификат)
electron-builder --win --certificateFile=cert.pfx
```

## Устранение типичных проблем при сборке

| Проблема | Решение |
|----------|---------|
| `node-pty` не найден в собранном приложении | Убедиться, что `extraResources` или `files` включает `build/Release/pty.node` |
| Ошибка `The module was compiled against a different Node.js version` | Запустить `electron-rebuild` после установки зависимостей |
| Приложение не запускается на Linux из-за отсутствия библиотек | Указать `"target"` в `linux` как `"AppImage"` (включает свои библиотеки) |

## CI/CD на GitHub Actions

Пример `.github/workflows/build.yml`:

```yaml
name: Build Electron App
on: push
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx electron-rebuild
      - run: npx electron-builder --publish never
```

## Документация

- [electron-builder](https://www.electron.build/)
- [electron-rebuild](https://github.com/electron/electron-rebuild)
- [Troubleshooting native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
