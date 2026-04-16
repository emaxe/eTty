# Настройка окружения и сборка нативных модулей

## Необходимые инструменты

- Node.js (версия 18+ LTS, совместимая с Electron)
- npm или yarn
- Системные зависимости для сборки нативных модулей:
  - **Windows**: Visual Studio Build Tools (с C++), Python 3.x
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `python3`, `make`, `g++`

## Инициализация проекта

```bash
mkdir my-terminal-app
cd my-terminal-app
npm init -y
npm install electron @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-search
npm install node-pty
```

## Проблема: `node-pty` собран для Node.js, а не для Electron

Решение: пересобрать модуль под версию Electron.

```bash
npm install --save-dev electron-rebuild
npx electron-rebuild
```

Или автоматически через `postinstall` скрипт в `package.json`:

```json
"scripts": {
  "postinstall": "electron-rebuild"
}
```

## Проверка совместимости версий

- Electron использует свою встроенную версию Node.js. Узнать её: `process.versions.node` в консоли Electron.
- `node-pty` должен быть совместим с этой версией. `electron-rebuild` решает проблему.

## Конфигурация Webpack / Vite (опционально)

Если используете сборщик, настройте обработку нативных модулей:

```javascript
// webpack.config.js
module.exports = {
  externals: {
    'node-pty': 'commonjs node-pty' // не бандлить нативный модуль
  }
};
```

## Запуск приложения в dev режиме

```bash
npx electron .
```

## Ссылки

- [electron-rebuild на GitHub](https://github.com/electron/electron-rebuild)
- [node-pty installation notes](https://github.com/microsoft/node-pty#installation)
- [Electron + node-pty boilerplate](https://github.com/microsoft/node-pty/tree/main/examples/electron)
