import { spawn } from 'node-pty'
import fs from 'fs'
import os from 'os'
import path from 'path'

const SHELL_PATH = '/bin/zsh'

export class PtyManager {
  constructor() {
    this.sessions = new Map()
  }

  _createZdotdir() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-'))
    const home = os.homedir()
    const userZshenv = path.join(home, '.zshenv')
    const userZshrc = path.join(home, '.zshrc')

    fs.writeFileSync(
      path.join(tmpDir, '.zshenv'),
      `[[ -f "${userZshenv}" ]] && builtin source "${userZshenv}"\n`
    )

    fs.writeFileSync(
      path.join(tmpDir, '.zshrc'),
      [
        `[[ -f "${userZshrc}" ]] && builtin source "${userZshrc}"`,
        `autoload -Uz add-zsh-hook`,
        `_etty_cwd() { printf '\\033]7;file://%s\\007' "$PWD"; }`,
        `add-zsh-hook precmd _etty_cwd`,
        `_etty_cwd`
      ].join('\n') + '\n'
    )

    return tmpDir
  }

  create({ cols, rows, cwd, webContents }) {
    const zdotdir = this._createZdotdir()
    const ptyProcess = spawn(SHELL_PATH, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env: { ...process.env, ZDOTDIR: zdotdir }
    })

    this.sessions.set(ptyProcess.pid, { pty: ptyProcess, webContents })

    ptyProcess.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send('pty:data', { pid: ptyProcess.pid, data })
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (!webContents.isDestroyed()) {
        webContents.send('pty:exit', { pid: ptyProcess.pid, exitCode, signal })
      }
      this.sessions.delete(ptyProcess.pid)
    })

    return { pid: ptyProcess.pid }
  }

  write(pid, data) {
    this.sessions.get(pid)?.pty.write(data)
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
