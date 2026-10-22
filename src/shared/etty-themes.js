/**
 * Фирменные темы eTty. Общий источник для main (theme-loader.js) и renderer (themes.js).
 *
 * Принципы: нейтральные тона без navy/slate/violet; поверхности отличаются ступенью светлоты;
 * один акцент — янтарь «цвета курсора» (на светлой теме затемнён до контраста ≥ 4.5:1);
 * ANSI-палитры подобраны под читаемость на своём фоне.
 */

const ETTY_DARK = {
  id: 'etty-dark',
  name: 'eTty Dark',
  ui: {
    bg: '#161616',
    surface: '#0f0f0f',
    border: '#262626',
    muted: '#7a7a7a',
    text: '#ededed',
    subtext: '#a8a8a8',
    accent: '#e8a33d',
    green: '#4fbf8b',
    red: '#f0626f',
    hover: '#232323'
  },
  terminal: {
    background: '#161616',
    foreground: '#ededed',
    cursor: '#e8a33d',
    selectionBackground: '#4a3a1c',
    black: '#2b2b2b',
    red: '#f0626f',
    green: '#4fbf8b',
    yellow: '#e8a33d',
    blue: '#6ba4e6',
    magenta: '#d08fc6',
    cyan: '#5fc3c9',
    white: '#c8c8c8',
    brightBlack: '#5a5a5a',
    brightRed: '#ff7b86',
    brightGreen: '#6fd6a3',
    brightYellow: '#f5bd5e',
    brightBlue: '#8abaf5',
    brightMagenta: '#e3a7da',
    brightCyan: '#7fd9de',
    brightWhite: '#ededed'
  },
  editor: {
    bg: '#161616',
    text: '#ededed',
    gutterBg: '#0f0f0f',
    lineNumber: '#7a7a7a',
    activeLine: '#202020',
    activeLineBg: 'rgba(255, 255, 255, 0.04)',
    selection: '#7a5a1f',
    selectionBorder: '#e8a33d',
    cursor: '#e8a33d',
    keyword: '#e8a33d',
    string: '#9ccf8a',
    number: '#e5906b',
    comment: '#7d7d7d',
    function: '#7fb4e8',
    type: '#5fc3c9',
    variable: '#d6d6d6',
    operator: '#a8a8a8',
    property: '#b8c7dd',
    tag: '#f0626f',
    attribute: '#e5906b',
    bracket: '#a8a8a8'
  }
}

const ETTY_LIGHT = {
  id: 'etty-light',
  name: 'eTty Light',
  ui: {
    bg: '#ffffff',
    surface: '#f4f4f4',
    border: '#e4e4e4',
    muted: '#707070',
    text: '#161616',
    subtext: '#555555',
    accent: '#a85f00',
    green: '#1f7a4d',
    red: '#c4242a',
    hover: '#ebebeb'
  },
  terminal: {
    background: '#ffffff',
    foreground: '#161616',
    cursor: '#a85f00',
    selectionBackground: '#f3dfbd',
    black: '#161616',
    red: '#c4242a',
    green: '#1f7a4d',
    yellow: '#8a6100',
    blue: '#1f5fb8',
    magenta: '#9b3d8f',
    cyan: '#0f7a85',
    white: '#5c5c5c',
    brightBlack: '#6b6b6b',
    brightRed: '#d8383e',
    brightGreen: '#248f5b',
    brightYellow: '#a87800',
    brightBlue: '#2b74d6',
    brightMagenta: '#b04aa2',
    brightCyan: '#1396a3',
    brightWhite: '#454545'
  },
  editor: {
    bg: '#ffffff',
    text: '#161616',
    gutterBg: '#f4f4f4',
    lineNumber: '#707070',
    activeLine: '#ececec',
    activeLineBg: 'rgba(0, 0, 0, 0.04)',
    selection: '#f0d7a8',
    selectionBorder: '#a85f00',
    cursor: '#a85f00',
    keyword: '#a8500a',
    string: '#1f7a4d',
    number: '#b23a2a',
    comment: '#6b6b6b',
    function: '#1f5fb8',
    type: '#0f7a85',
    variable: '#161616',
    operator: '#555555',
    property: '#2a4f8f',
    tag: '#c4242a',
    attribute: '#8a5a00',
    bracket: '#555555'
  }
}

/** id → тема (с полем id). */
export const ETTY_THEMES = Object.freeze({
  [ETTY_DARK.id]: ETTY_DARK,
  [ETTY_LIGHT.id]: ETTY_LIGHT
})

export const DEFAULT_DARK_THEME_ID = ETTY_DARK.id
export const DEFAULT_LIGHT_THEME_ID = ETTY_LIGHT.id
