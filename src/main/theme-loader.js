import { app } from 'electron'
import { join } from 'path'
import { readdir, readFile, writeFile, mkdir, access } from 'fs/promises'
import log from 'electron-log'

const CONFIG_DIR = () => join(app.getPath('userData'), 'eTty')
const THEMES_DIR = () => join(CONFIG_DIR(), 'themes')

/**
 * Built-in fallback themes. These are always available.
 */
const BUILT_IN_THEMES = {
  dark: {
    id: 'dark',
    name: 'Dark',
    ui: {
      bg: '#1e1e1e',
      surface: '#141414',
      border: '#2d2d2d',
      muted: '#666666',
      text: '#d4d4d4',
      subtext: '#a0a0a0',
      accent: '#569cd6',
      green: '#4ec9b0',
      red: '#f14c4c',
      hover: '#2a2d2e'
    },
    terminal: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5'
    },
    editor: {
      bg: '#1e1e1e',
      text: '#d4d4d4',
      gutterBg: '#141414',
      lineNumber: '#6e7681',
      activeLine: '#2c2c2c',
      selection: '#264f78',
      cursor: '#d4d4d4',
      keyword: '#569cd6',
      string: '#ce9178',
      number: '#b5cea8',
      comment: '#6a9955',
      function: '#dcdcaa',
      type: '#4ec9b0',
      variable: '#9cdcfe',
      operator: '#d4d4d4',
      property: '#9cdcfe',
      tag: '#569cd6',
      attribute: '#9cdcfe',
      bracket: '#ffd700'
    }
  },

  light: {
    id: 'light',
    name: 'Light',
    ui: {
      bg: '#ffffff',
      surface: '#f5f5f5',
      border: '#e0e0e0',
      muted: '#888888',
      text: '#333333',
      subtext: '#666666',
      accent: '#007acc',
      green: '#008000',
      red: '#c00000',
      hover: '#e8e8e8'
    },
    terminal: {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      selectionBackground: '#add6ff',
      black: '#000000',
      red: '#cd3131',
      green: '#00bc00',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#14ce14',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    },
    editor: {
      bg: '#ffffff',
      text: '#333333',
      gutterBg: '#f5f5f5',
      lineNumber: '#888888',
      activeLine: '#f5f5f5',
      selection: '#add6ff',
      cursor: '#333333',
      keyword: '#0000ff',
      string: '#a31515',
      number: '#098658',
      comment: '#008000',
      function: '#795e26',
      type: '#267f99',
      variable: '#001080',
      operator: '#333333',
      property: '#001080',
      tag: '#0000ff',
      attribute: '#001080',
      bracket: '#000000'
    }
  }
}

/**
 * Initial themes to populate the themes/ directory on first run.
 * These are the former built-in themes from themes.js.
 */
const INITIAL_THEMES = {
  'catppuccin-mocha': {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    ui: {
      bg: '#1e1e2e',
      surface: '#181825',
      border: '#313244',
      muted: '#6c7086',
      text: '#cdd6f4',
      subtext: '#a6adc8',
      accent: '#89b4fa',
      green: '#a6e3a1',
      red: '#f38ba8',
      hover: '#45475a'
    },
    terminal: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b70',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#cba6f7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8'
    },
    editor: {
      bg: '#1e1e2e',
      text: '#cdd6f4',
      gutterBg: '#181825',
      lineNumber: '#6c7086',
      activeLine: '#25253a',
      selection: '#585b70',
      cursor: '#f5e0dc',
      keyword: '#cba6f7',
      string: '#a6e3a1',
      number: '#f9e2af',
      comment: '#6c7086',
      function: '#89b4fa',
      type: '#f9e2af',
      variable: '#cdd6f4',
      operator: '#94e2d5',
      property: '#89dceb',
      tag: '#f38ba8',
      attribute: '#f9e2af',
      bracket: '#a6adc8'
    }
  },

  monokai: {
    id: 'monokai',
    name: 'Monokai Pro',
    ui: {
      bg: '#272822',
      surface: '#1e1f1c',
      border: '#3e3d32',
      muted: '#75715e',
      text: '#f8f8f2',
      subtext: '#cfcfc2',
      accent: '#66d9e8',
      green: '#a6e22e',
      red: '#f92672',
      hover: '#49483e'
    },
    terminal: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: '#49483e',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9e8',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9e8',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5'
    },
    editor: {
      bg: '#272822',
      text: '#f8f8f2',
      gutterBg: '#1e1f1c',
      lineNumber: '#75715e',
      activeLine: '#3a3a2e',
      selection: '#49483e',
      cursor: '#f8f8f0',
      keyword: '#f92672',
      string: '#f4bf75',
      number: '#ae81ff',
      comment: '#75715e',
      function: '#a6e22e',
      type: '#66d9e8',
      variable: '#f8f8f2',
      operator: '#f92672',
      property: '#a1efe4',
      tag: '#f92672',
      attribute: '#a6e22e',
      bracket: '#cfcfc2'
    }
  },

  dracula: {
    id: 'dracula',
    name: 'Dracula',
    ui: {
      bg: '#282a36',
      surface: '#21222c',
      border: '#44475a',
      muted: '#6272a4',
      text: '#f8f8f2',
      subtext: '#bcc2cd',
      accent: '#bd93f9',
      green: '#50fa7b',
      red: '#ff5555',
      hover: '#44475a'
    },
    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    },
    editor: {
      bg: '#282a36',
      text: '#f8f8f2',
      gutterBg: '#21222c',
      lineNumber: '#6272a4',
      activeLine: '#313342',
      selection: '#44475a',
      cursor: '#f8f8f2',
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      comment: '#6272a4',
      function: '#50fa7b',
      type: '#8be9fd',
      variable: '#f8f8f2',
      operator: '#ff79c6',
      property: '#8be9fd',
      tag: '#ff5555',
      attribute: '#f1fa8c',
      bracket: '#bcc2cd'
    }
  },

  'one-dark': {
    id: 'one-dark',
    name: 'One Dark',
    ui: {
      bg: '#282c34',
      surface: '#21252b',
      border: '#3e4451',
      muted: '#5c6370',
      text: '#abb2bf',
      subtext: '#9da5b4',
      accent: '#61afef',
      green: '#98c379',
      red: '#e06c75',
      hover: '#2c313a'
    },
    terminal: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      selectionBackground: '#3e4451',
      black: '#3f4451',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#4f5666',
      brightRed: '#be5046',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    },
    editor: {
      bg: '#282c34',
      text: '#abb2bf',
      gutterBg: '#21252b',
      lineNumber: '#5c6370',
      activeLine: '#2c313c',
      selection: '#3e4451',
      cursor: '#528bff',
      keyword: '#c678dd',
      string: '#98c379',
      number: '#d19a66',
      comment: '#5c6370',
      function: '#61afef',
      type: '#56b6c2',
      variable: '#abb2bf',
      operator: '#56b6c2',
      property: '#e06c75',
      tag: '#e06c75',
      attribute: '#e5c07b',
      bracket: '#9da5b4'
    }
  },

  nord: {
    id: 'nord',
    name: 'Nord',
    ui: {
      bg: '#2e3440',
      surface: '#242933',
      border: '#3b4252',
      muted: '#4c566a',
      text: '#d8dee9',
      subtext: '#e5e9f0',
      accent: '#88c0d0',
      green: '#a3be8c',
      red: '#bf616a',
      hover: '#434c5e'
    },
    terminal: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    },
    editor: {
      bg: '#2e3440',
      text: '#d8dee9',
      gutterBg: '#242933',
      lineNumber: '#4c566a',
      activeLine: '#343a47',
      selection: '#434c5e',
      cursor: '#d8dee9',
      keyword: '#81a1c1',
      string: '#a3be8c',
      number: '#b48ead',
      comment: '#4c566a',
      function: '#88c0d0',
      type: '#8fbcbb',
      variable: '#d8dee9',
      operator: '#81a1c1',
      property: '#88c0d0',
      tag: '#bf616a',
      attribute: '#ebcb8b',
      bracket: '#e5e9f0'
    }
  },

  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    ui: {
      bg: '#002b36',
      surface: '#073642',
      border: '#094652',
      muted: '#586e75',
      text: '#839496',
      subtext: '#93a1a1',
      accent: '#268bd2',
      green: '#859900',
      red: '#dc322f',
      hover: '#094652'
    },
    terminal: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    },
    editor: {
      bg: '#002b36',
      text: '#839496',
      gutterBg: '#073642',
      lineNumber: '#586e75',
      activeLine: '#073642',
      selection: '#0d4a5a',
      cursor: '#839496',
      keyword: '#859900',
      string: '#2aa198',
      number: '#d33682',
      comment: '#586e75',
      function: '#268bd2',
      type: '#b58900',
      variable: '#93a1a1',
      operator: '#dc322f',
      property: '#268bd2',
      tag: '#dc322f',
      attribute: '#b58900',
      bracket: '#657b83'
    }
  },

  'gruvbox-dark': {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    ui: {
      bg: '#282828',
      surface: '#1d2021',
      border: '#3c3836',
      muted: '#665c54',
      text: '#ebdbb2',
      subtext: '#d5c4a1',
      accent: '#83a598',
      green: '#b8bb26',
      red: '#fb4934',
      hover: '#504945'
    },
    terminal: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
    },
    editor: {
      bg: '#282828',
      text: '#ebdbb2',
      gutterBg: '#1d2021',
      lineNumber: '#665c54',
      activeLine: '#32302f',
      selection: '#504945',
      cursor: '#ebdbb2',
      keyword: '#fb4934',
      string: '#b8bb26',
      number: '#d3869b',
      comment: '#928374',
      function: '#fabd2f',
      type: '#8ec07c',
      variable: '#ebdbb2',
      operator: '#fb4934',
      property: '#83a598',
      tag: '#fb4934',
      attribute: '#fabd2f',
      bracket: '#d5c4a1'
    }
  },

  'catppuccin-latte': {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    ui: {
      bg: '#eff1f5',
      surface: '#e6e9ef',
      border: '#ccd0da',
      muted: '#9ca0b0',
      text: '#4c4f69',
      subtext: '#6c6f85',
      accent: '#1e66f5',
      green: '#40a02b',
      red: '#d20f39',
      hover: '#dce0e8'
    },
    terminal: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      cursor: '#dc8a78',
      selectionBackground: '#ccd0da',
      black: '#5c5f77',
      red: '#d20f39',
      green: '#40a02b',
      yellow: '#df8e1d',
      blue: '#1e66f5',
      magenta: '#8839ef',
      cyan: '#179299',
      white: '#acb0be',
      brightBlack: '#6c6f85',
      brightRed: '#d20f39',
      brightGreen: '#40a02b',
      brightYellow: '#df8e1d',
      brightBlue: '#1e66f5',
      brightMagenta: '#8839ef',
      brightCyan: '#179299',
      brightWhite: '#bcc0cc'
    },
    editor: {
      bg: '#eff1f5',
      text: '#4c4f69',
      gutterBg: '#e6e9ef',
      lineNumber: '#9ca0b0',
      activeLine: '#e6e9ef',
      selection: '#ccd0da',
      cursor: '#dc8a78',
      keyword: '#8839ef',
      string: '#40a02b',
      number: '#df8e1d',
      comment: '#9ca0b0',
      function: '#1e66f5',
      type: '#df8e1d',
      variable: '#4c4f69',
      operator: '#179299',
      property: '#04a5e5',
      tag: '#d20f39',
      attribute: '#df8e1d',
      bracket: '#6c6f85'
    }
  },

  'github-light': {
    id: 'github-light',
    name: 'GitHub Light',
    ui: {
      bg: '#ffffff',
      surface: '#f6f8fa',
      border: '#d0d7de',
      muted: '#8c959f',
      text: '#1f2328',
      subtext: '#57606a',
      accent: '#0969da',
      green: '#1a7f37',
      red: '#cf222e',
      hover: '#eaeef2'
    },
    terminal: {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#0969da',
      selectionBackground: '#b6e3ff',
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f'
    },
    editor: {
      bg: '#ffffff',
      text: '#1f2328',
      gutterBg: '#f6f8fa',
      lineNumber: '#8c959f',
      activeLine: '#f6f8fa',
      selection: '#b6e3ff',
      cursor: '#0969da',
      keyword: '#cf222e',
      string: '#0a3069',
      number: '#0550ae',
      comment: '#8c959f',
      function: '#8250df',
      type: '#953800',
      variable: '#1f2328',
      operator: '#cf222e',
      property: '#0550ae',
      tag: '#116329',
      attribute: '#0550ae',
      bracket: '#57606a'
    }
  },

  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized Light',
    ui: {
      bg: '#fdf6e3',
      surface: '#eee8d5',
      border: '#d5cdb6',
      muted: '#93a1a1',
      text: '#657b83',
      subtext: '#839496',
      accent: '#268bd2',
      green: '#859900',
      red: '#dc322f',
      hover: '#e8e0cb'
    },
    terminal: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#d5cdb6',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    },
    editor: {
      bg: '#fdf6e3',
      text: '#657b83',
      gutterBg: '#eee8d5',
      lineNumber: '#93a1a1',
      activeLine: '#eee8d5',
      selection: '#d5cdb6',
      cursor: '#586e75',
      keyword: '#859900',
      string: '#2aa198',
      number: '#d33682',
      comment: '#93a1a1',
      function: '#268bd2',
      type: '#b58900',
      variable: '#657b83',
      operator: '#859900',
      property: '#2aa198',
      tag: '#dc322f',
      attribute: '#b58900',
      bracket: '#839496'
    }
  },

  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    ui: {
      bg: '#1a1b26',
      surface: '#16161e',
      border: '#2a2b3d',
      muted: '#565f89',
      text: '#c0caf5',
      subtext: '#9aa5ce',
      accent: '#7aa2f7',
      green: '#9ece6a',
      red: '#f7768e',
      hover: '#292e42'
    },
    terminal: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#292e42',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#c0caf5',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#e4e4ef'
    },
    editor: {
      bg: '#1a1b26',
      text: '#c0caf5',
      gutterBg: '#16161e',
      lineNumber: '#565f89',
      activeLine: '#292e42',
      selection: '#3d3f5f',
      cursor: '#c0caf5',
      keyword: '#bb9af7',
      string: '#9ece6a',
      number: '#ff9e64',
      comment: '#565f89',
      function: '#7aa2f7',
      type: '#e0af68',
      variable: '#c0caf5',
      operator: '#89ddff',
      property: '#7dcfff',
      tag: '#f7768e',
      attribute: '#e0af68',
      bracket: '#9aa5ce'
    }
  },

  'night-owl': {
    id: 'night-owl',
    name: 'Night Owl',
    ui: {
      bg: '#011627',
      surface: '#0d2538',
      border: '#2d4a68',
      muted: '#637777',
      text: '#d6deeb',
      subtext: '#a8b7cc',
      accent: '#82aaff',
      green: '#7cc7f7',
      red: '#ff2d6d',
      hover: '#16425c'
    },
    terminal: {
      background: '#011627',
      foreground: '#d6deeb',
      cursor: '#d6deeb',
      selectionBackground: '#2d4a68',
      black: '#011627',
      red: '#ff2d6d',
      green: '#7cc7f7',
      yellow: '#ff952a',
      blue: '#82aaff',
      magenta: '#c792ea',
      cyan: '#7cdcfa',
      white: '#d6deeb',
      brightBlack: '#7b8e9e',
      brightRed: '#ff5370',
      brightGreen: '#add7ff',
      brightYellow: '#ffe8a3',
      brightBlue: '#82aaff',
      brightMagenta: '#c792ea',
      brightCyan: '#add7ff',
      brightWhite: '#e4e4ef'
    },
    editor: {
      bg: '#011627',
      text: '#d6deeb',
      gutterBg: '#0d2538',
      lineNumber: '#637777',
      activeLine: '#1b3b5f',
      selection: '#2d4a68',
      cursor: '#d6deeb',
      keyword: '#c792ea',
      string: '#ecc48d',
      number: '#f78c6c',
      comment: '#637777',
      function: '#82aaff',
      type: '#add7ff',
      variable: '#d6deeb',
      operator: '#89ddff',
      property: '#7cdcfa',
      tag: '#ff2d6d',
      attribute: '#ff952a',
      bracket: '#a8b7cc'
    }
  }
}

const REQUIRED_UI_FIELDS = ['bg', 'surface', 'border', 'muted', 'text', 'subtext', 'accent', 'green', 'red', 'hover']
const REQUIRED_TERMINAL_FIELDS = [
  'background', 'foreground', 'cursor', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
]
const REQUIRED_EDITOR_FIELDS = [
  'bg', 'text', 'gutterBg', 'lineNumber', 'activeLine', 'selection', 'cursor',
  'keyword', 'string', 'number', 'comment', 'function', 'type', 'variable',
  'operator', 'property', 'tag', 'attribute', 'bracket'
]

function validateTheme(theme, fileName) {
  const errors = []

  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    return ['Theme must be a JSON object']
  }

  for (const field of ['id', 'name']) {
    if (typeof theme[field] !== 'string' || !theme[field]) {
      errors.push(`Missing or invalid required field: ${field}`)
    }
  }

  for (const section of ['ui', 'terminal', 'editor']) {
    if (!theme[section] || typeof theme[section] !== 'object' || Array.isArray(theme[section])) {
      errors.push(`Missing or invalid required section: ${section}`)
      continue
    }

    let requiredFields
    if (section === 'ui') requiredFields = REQUIRED_UI_FIELDS
    else if (section === 'terminal') requiredFields = REQUIRED_TERMINAL_FIELDS
    else requiredFields = REQUIRED_EDITOR_FIELDS

    for (const field of requiredFields) {
      if (typeof theme[section][field] !== 'string' || !theme[section][field]) {
        errors.push(`Missing or invalid field in ${section}: ${field}`)
      }
    }
  }

  return errors
}

async function initializeThemesDir() {
  try {
    await mkdir(THEMES_DIR(), { recursive: true })
    const entries = await readdir(THEMES_DIR())
    const jsonFiles = entries.filter(f => f.endsWith('.json'))

    if (jsonFiles.length === 0) {
      log.info('themes: directory empty, initializing with built-in themes')
      for (const [key, theme] of Object.entries(INITIAL_THEMES)) {
        const filePath = join(THEMES_DIR(), `${key}.json`)
        await writeFile(filePath, JSON.stringify(theme, null, 2), 'utf-8')
      }
      log.info(`themes: initialized ${Object.keys(INITIAL_THEMES).length} theme files`)
    }
  } catch (e) {
    log.error('themes: failed to initialize themes directory:', e.message)
    throw e
  }
}

export async function loadThemes() {
  const warnings = []
  const themes = new Map()

  // Always register built-in themes first (as fallback)
  for (const [id, theme] of Object.entries(BUILT_IN_THEMES)) {
    themes.set(id, theme)
  }

  try {
    await initializeThemesDir()
  } catch {
    // If initialization fails, at least we have built-in themes
    log.warn('themes: using only built-in themes due to initialization failure')
    return { themes, warnings: [...warnings, 'Failed to initialize themes directory, using built-in themes only'] }
  }

  let entries
  try {
    entries = await readdir(THEMES_DIR())
  } catch (e) {
    log.warn('themes: failed to read themes directory:', e.message)
    return { themes, warnings: [...warnings, 'Failed to read themes directory, using built-in themes only'] }
  }

  const jsonFiles = entries.filter(f => f.endsWith('.json'))
  const seenIds = new Set()

  for (const fileName of jsonFiles) {
    const filePath = join(THEMES_DIR(), fileName)
    let parsed

    try {
      const raw = await readFile(filePath, 'utf-8')
      parsed = JSON.parse(raw)
    } catch (e) {
      warnings.push(`Invalid theme file "${fileName}": ${e.message}`)
      log.warn(`themes: skipping invalid file "${fileName}": ${e.message}`)
      continue
    }

    const errors = validateTheme(parsed, fileName)
    if (errors.length > 0) {
      warnings.push(`Invalid theme "${fileName}": ${errors.join('; ')}`)
      log.warn(`themes: skipping invalid theme "${fileName}": ${errors.join('; ')}`)
      continue
    }

    if (seenIds.has(parsed.id)) {
      warnings.push(`Duplicate theme id "${parsed.id}" in "${fileName}" — skipped`)
      log.warn(`themes: skipping duplicate id "${parsed.id}" in "${fileName}"`)
      continue
    }
    seenIds.add(parsed.id)

    // External themes override built-in if same id (but built-ins are 'dark' and 'light',
    // and external themes should have different ids; if they match, external wins)
    themes.set(parsed.id, parsed)
    log.info(`themes: loaded "${parsed.name}" (${parsed.id}) from ${fileName}`)
  }

  const externalCount = themes.size - Object.keys(BUILT_IN_THEMES).length
  log.info(`themes: loaded ${externalCount} external theme(s), ${Object.keys(BUILT_IN_THEMES).length} built-in`)

  return { themes, warnings }
}
