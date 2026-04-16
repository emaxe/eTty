# Интеграция xterm.js в Electron Renderer

## Базовая инициализация

```javascript
// renderer.js
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';

import '@xterm/xterm/css/xterm.css';

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Consolas, "Courier New", monospace',
  theme: {
    background: '#1e1e2f',
    foreground: '#cdd6f4',
    cursor: '#f9e2af',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#cba6f7',
    cyan: '#94e2d5',
    white: '#bac2de'
  },
  allowProposedApi: true, // для WebGL
  smoothScrollDuration: 0,
});

// Аддоны
const fitAddon = new FitAddon();
const searchAddon = new SearchAddon();

term.loadAddon(fitAddon);
term.loadAddon(searchAddon);

// WebGL рендеринг (ускорение)
const webglAddon = new WebglAddon();
term.loadAddon(webglAddon);

// Отрисовка в DOM
term.open(document.getElementById('terminal-container'));

// Подгонка под размер окна
fitAddon.fit();
window.addEventListener('resize', () => fitAddon.fit());
```

## Ключевые события xterm.js

| Событие | Описание | Пример использования |
|---------|----------|----------------------|
| `onData` | Пользователь ввёл данные (строку с escape-последовательностями) | Отправить в PTY через IPC |
| `onResize` | Размер терминала изменился | Отправить `pty.resize` в main |
| `onTitleChange` | Изменился заголовок окна (escape-последовательность) | Обновить заголовок окна Electron |
| `onSelectionChange` | Пользователь выделил текст | Показать кнопку копирования |

## Обработка ввода и вывода

```javascript
// Вывод от PTY (приходит через IPC)
window.electronAPI.onPtyData((data) => {
  term.write(data); // xterm.js сам парсит escape-последовательности
});

// Ввод пользователя → PTY
term.onData((data) => {
  window.electronAPI.ptyWrite(data);
});
```

## Полезные аддоны

| Аддон | Функция | Установка |
|-------|---------|-----------|
| `@xterm/addon-fit` | Подгонка размера терминала под контейнер | `npm install @xterm/addon-fit` |
| `@xterm/addon-webgl` | GPU-рендеринг (повышает FPS) | `npm install @xterm/addon-webgl` |
| `@xterm/addon-search` | Поиск по тексту (Ctrl+F) | `npm install @xterm/addon-search` |
| `@xterm/addon-web-links` | Превращает URL в кликабельные ссылки | `npm install @xterm/addon-web-links` |
| `@xterm/addon-clipboard` | Копирование/вставка | `npm install @xterm/addon-clipboard` |

## Получение текущего выделения

```javascript
const selection = term.getSelection();
if (selection) {
  navigator.clipboard.writeText(selection);
}
```

## Документация

- [xterm.js API](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/)
- [Список аддонов](https://github.com/xtermjs/xterm.js#addons)
