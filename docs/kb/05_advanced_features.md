# Расширенный функционал (как в Hyper)

## Файл конфигурации `.hyper.js`

Hyper использует JavaScript-конфиг, который перезагружается без перезапуска.

```javascript
// ~/.hyper.js (в домашней директории пользователя)
module.exports = {
  config: {
    fontSize: 14,
    fontFamily: 'Fira Code, "Courier New"',
    cursorBlink: true,
    theme: 'custom-theme',
    shell: '/bin/zsh',
    shellArgs: ['-l'],
    env: {
      TERM: 'xterm-256color',
    },
    padding: '12px 14px',
    colors: {
      black: '#000000',
      red: '#ff5555',
      // ...
    }
  },
  plugins: ['hyper-tabs', 'hyper-search'],
  localPlugins: ['~/my-plugin']
};
```

Применение в приложении:

```javascript
const userConfig = require('os').homedir() + '/.hyper.js';
const config = eval(fs.readFileSync(userConfig, 'utf8')); // осторожно, eval
// Или использовать JSON с комментариями.
```

## Система тем (переключение на лету)

```javascript
// Отправить новую тему в renderer через IPC
ipcRenderer.on('apply-theme', (event, theme) => {
  term.options.theme = theme;
  // также обновить CSS переменные для других элементов
});
```

## Плавающие окна (Floating Windows)

Создание нового окна Electron с типом `'toolbar'` или `'desktop'`:

```javascript
const { BrowserWindow } = require('electron');
let floatWin = new BrowserWindow({
  width: 800,
  height: 500,
  alwaysOnTop: true,
  transparent: true,
  frame: false,
  webPreferences: { nodeIntegration: true }
});
floatWin.loadURL('...'); // загружаем ту же терминальную страницу
```

## Плагины

Архитектура плагинов Hyper основана на CommonJS модулях, которые экспортируют функции для расширения.

```javascript
// Пример плагина (index.js)
exports.decorateConfig = (config) => {
  return Object.assign({}, config, {
    backgroundColor: '#000'
  });
};

exports.onWindow = (window) => {
  window.webContents.on('did-finish-load', () => {
    console.log('Window ready');
  });
};
```

Загрузка плагинов: сканирование `node_modules/hyper-*` и выполнение `require()`.

## Менеджмент дочерних процессов

Чтобы избежать зомби-процессов:

```javascript
// main: при закрытии окна
app.on('window-all-closed', () => {
  for (let [pid, pty] of sessions) {
    pty.kill();
  }
  app.quit();
});
```

## Глобальные горячие клавиши

```javascript
const { globalShortcut } = require('electron');
globalShortcut.register('CommandOrControl+Shift+T', () => {
  // Создать новую вкладку
});
```

## Интеграция с системным буфером обмена

```javascript
// renderer: копирование по Ctrl+Shift+C
term.onKey((e) => {
  if (e.domEvent.ctrlKey && e.key === 'C' && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection());
    e.domEvent.preventDefault();
  }
});
```

## Ссылки

- [Hyper config docs](https://hyper.is/#cfg)
- [Hyper plugin API](https://github.com/vercel/hyper/blob/main/docs/plugins.md)
