import { spawn } from 'node-pty'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IPC_CHANNELS } from '../shared/ipc-channels.js'

const SHELL_PATH = '/bin/zsh'

const PROMPT_MAP = {
  short: '%1~ %% ',
  minimal: '> ',
  arrow: '%1~ ❯ '
}

/**
 * Управляет PTY-сессиями (псевдотерминалами) для вкладок.
 * Каждая вкладка получает изолированную zsh-сессию с собственными ZDOTDIR и HISTFILE.
 */
export class PtyManager {
  constructor() {
    /** @type {Map<number, {pty, webContents, tabId: string, historyFile: string, initialHistSize: number}>} */
    this.sessions = new Map()
  }

  /**
   * Создаёт временный ZDOTDIR с кастомными .zshenv и .zshrc.
   * .zshenv — sourcing пользовательского ~/.zshenv
   * .zshrc — sourcing ~/.zshrc + настройка истории + zsh-хуки для OSC 7/133
   * @param {string|null} historyFile — путь к HISTFILE для этой сессии
   * @returns {string} путь к временной директории ZDOTDIR
   */
  _createZdotdir(historyFile, promptStyle) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-'))
    const home = os.homedir()
    const userZshenv = path.join(home, '.zshenv')
    const userZshrc = path.join(home, '.zshrc')

    fs.writeFileSync(
      path.join(tmpDir, '.zshenv'),
      `[[ -f "${userZshenv}" ]] && builtin source "${userZshenv}"\n`
    )

    const historyLines = historyFile
      ? [
          `HISTFILE="${historyFile}"`,
          `HISTSIZE=5000`,
          `SAVEHIST=5000`,
          `setopt INC_APPEND_HISTORY`,
          `setopt HIST_IGNORE_DUPS`,
          `setopt HIST_IGNORE_SPACE`
        ]
      : []

    fs.writeFileSync(
      path.join(tmpDir, '.zshrc'),
      [
        `[[ -f "${userZshrc}" ]] && builtin source "${userZshrc}"`,
        `PROMPT_EOL_MARK=""`,
        ...historyLines,
        `autoload -Uz add-zsh-hook`,
        `_etty_cwd() { printf '\\033]7;file://%s\\007' "$PWD"; }`,
        `_etty_preexec() { printf '\\033]133;C\\007' }`,
        `_etty_precmd_state() { printf '\\033]133;A\\007' }`,
        `add-zsh-hook precmd _etty_cwd`,
        `add-zsh-hook preexec _etty_preexec`,
        `add-zsh-hook precmd _etty_precmd_state`,
        `_etty_cwd`,
        ...(PROMPT_MAP[promptStyle] ? [`PROMPT='${PROMPT_MAP[promptStyle]}'`] : [])
      ].join('\n') + '\n'
    )

    return tmpDir
  }

  /**
   * Запускает новую zsh-сессию в изолированном PTY.
   * @returns {{pid: number}} — PID процесса для идентификации сессии
   */
  create({ cols, rows, cwd, webContents, tabId, historyFile, initialHistSize, promptStyle }) {
    const zdotdir = this._createZdotdir(historyFile, promptStyle)
    const ptyProcess = spawn(SHELL_PATH, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env: {
        ...process.env,
        ZDOTDIR: zdotdir,
        LANG: process.env.LANG || 'en_US.UTF-8',
        LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8',
        PATH: process.env.PATH
          ? `/usr/local/bin:${process.env.PATH}`
          : '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
      }
    })

    this.sessions.set(ptyProcess.pid, { pty: ptyProcess, webContents, tabId, historyFile, initialHistSize: initialHistSize || 0 })

    // Batch PTY output: accumulate chunks and flush every ~8 ms.
    // This prevents IPC flooding when TUI apps (Copilot CLI, etc.)
    // redraw the screen at high frequency.
    let dataChunks = []
    let flushTimer = null

    const flushData = () => {
      if (dataChunks.length > 0 && !webContents.isDestroyed()) {
        webContents.send(IPC_CHANNELS.PTY_DATA, { pid: ptyProcess.pid, data: dataChunks.join('') })
        dataChunks = []
      }
      flushTimer = null
    }

    ptyProcess.onData((data) => {
      dataChunks.push(data)
      if (!flushTimer) {
        flushTimer = setTimeout(flushData, 8)
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushData()
      }
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_CHANNELS.PTY_EXIT, { pid: ptyProcess.pid, exitCode, signal })
      }
      this.sessions.delete(ptyProcess.pid)
    })

    return { pid: ptyProcess.pid }
  }

  write(pid, data) {
    this.sessions.get(pid)?.pty.write(data)
  }

  getSession(pid) {
    return this.sessions.get(pid) || null
  }

  resize(pid, cols, rows) {
    this.sessions.get(pid)?.pty.resize(cols, rows)
  }

  kill(pid) {
    const session = this.sessions.get(pid)
    if (session) {
      session.pty.kill()
      this.sessions.delete(pid)
    }
  }

  killAll() {
    for (const [, session] of this.sessions) {
      session.pty.kill()
    }
    this.sessions.clear()
  }
}
