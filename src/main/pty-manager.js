import { spawn } from 'node-pty'

const SHELL_PATH = '/bin/zsh'

export class PtyManager {
  constructor() {
    this.sessions = new Map()
  }

  create({ cols, rows, cwd, webContents }) {
    const ptyProcess = spawn(SHELL_PATH, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env: process.env
    })

    this.sessions.set(ptyProcess.pid, { pty: ptyProcess, webContents })

    ptyProcess.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send('pty:data', data)
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
