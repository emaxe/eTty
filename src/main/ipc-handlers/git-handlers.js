import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

// Maps a porcelain status letter (index or working_dir column) to the badge
// letter shown in the UI. 'C' (copy) and 'T' (typechange) fold into the
// closest equivalent; 'U' marks an unresolved merge conflict.
const STATUS_LETTER_MAP = { A: 'A', M: 'M', D: 'D', R: 'R', C: 'R', T: 'M', U: 'U' }

/**
 * @param {Electron.IpcMain} ipcMain
 */
export function registerGitHandlers(ipcMain) {
  /**
   * Parse `git diff --numstat` output into a Map(path => { additions, deletions }).
   * Binary files appear as `-\t-\tpath`.
   */
  function parseNumstat(output) {
    const map = new Map()
    for (const line of (output || '').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split('\t')
      if (parts.length < 3) continue
      const additions = parts[0] === '-' ? 0 : (parseInt(parts[0], 10) || 0)
      const deletions = parts[1] === '-' ? 0 : (parseInt(parts[1], 10) || 0)
      const rawPath = parts.slice(2).join('\t')
      const normPath = rawPath.includes('=>')
        ? rawPath.replace(/\{.*? => (.*?)\}/g, '$1').replace(/^.*? => /, '')
        : rawPath
      map.set(rawPath, { additions, deletions })
      if (normPath !== rawPath) {
        map.set(normPath, { additions, deletions })
      }
    }
    return map
  }

  ipcMain.handle(IPC_CHANNELS.GIT_GET_STATUS, async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) return { notARepo: true }

      const [status, branch] = await Promise.all([
        git.status(),
        git.branch()
      ])

      const isUntrackedEntry = (f) => f.index === '?' && f.working_dir === '?'
      const trackedFiles = status.files.filter(f => !isUntrackedEntry(f))
      const untrackedFiles = status.files.filter(isUntrackedEntry)

      const trackedPaths = trackedFiles.map(f => f.path)
      let ignoredTracked = []
      try {
        if (trackedPaths.length > 0 && trackedPaths.length <= 500) {
          const raw = await git.raw(['check-ignore', '--no-index', ...trackedPaths])
          ignoredTracked = raw.split('\n').filter(Boolean)
        }
      } catch {
        ignoredTracked = []
      }

      let ignoredPaths = []
      try {
        const porcelain = await git.raw(['status', '--porcelain', '--ignored=traditional'])
        ignoredPaths = porcelain
          .split('\n')
          .filter(line => line.startsWith('!! '))
          .map(line => line.slice(3).trim())
      } catch {
        ignoredPaths = []
      }

      let stagedNumstatMap = new Map()
      let unstagedNumstatMap = new Map()

      const hasStaged = trackedFiles.some(f => f.index !== ' ' && f.index !== '?')
      const hasUnstaged = trackedFiles.some(f => f.working_dir !== ' ' && f.working_dir !== '?')

      const [stagedOut, unstagedOut] = await Promise.all([
        hasStaged ? git.raw(['diff', '--numstat', '--cached', '-M']).catch(() => '') : Promise.resolve(''),
        hasUnstaged ? git.raw(['diff', '--numstat', '-M']).catch(() => '') : Promise.resolve('')
      ])

      if (stagedOut) stagedNumstatMap = parseNumstat(stagedOut)
      if (unstagedOut) unstagedNumstatMap = parseNumstat(unstagedOut)

      const staged = []
      const unstaged = []
      let totalAdditions = 0
      let totalDeletions = 0

      for (const f of trackedFiles) {
        const isIgnored = ignoredTracked.includes(f.path)
        const isRename = f.index === 'R' || f.index === 'C' || f.working_dir === 'R' || f.working_dir === 'C'

        if (f.index !== ' ' && f.index !== '?') {
          const stats = stagedNumstatMap.get(f.path) || { additions: 0, deletions: 0 }
          totalAdditions += stats.additions
          totalDeletions += stats.deletions
          const entry = {
            path: f.path,
            status: STATUS_LETTER_MAP[f.index] || (isRename ? 'R' : 'M'),
            additions: stats.additions,
            deletions: stats.deletions,
            isIgnored
          }
          if (f.from) entry.from = f.from
          staged.push(entry)
        }
        if (f.working_dir !== ' ' && f.working_dir !== '?') {
          const stats = unstagedNumstatMap.get(f.path) || { additions: 0, deletions: 0 }
          totalAdditions += stats.additions
          totalDeletions += stats.deletions
          const entry = {
            path: f.path,
            status: STATUS_LETTER_MAP[f.working_dir] || (isRename ? 'R' : 'M'),
            additions: stats.additions,
            deletions: stats.deletions,
            isIgnored
          }
          if (f.from) entry.from = f.from
          unstaged.push(entry)
        }
      }

      const untracked = untrackedFiles.map(f => ({
        path: f.path,
        additions: 0,
        deletions: 0,
        status: '?'
      }))

      let ahead = 0
      let behind = 0
      try {
        if (branch.current) {
          const trackingInfo = await git.raw(['rev-list', '--left-right', '--count', `${branch.current}...@{u}`])
          const parts = trackingInfo.trim().split('\t')
          if (parts.length === 2) {
            ahead = parseInt(parts[0], 10) || 0
            behind = parseInt(parts[1], 10) || 0
          }
        }
      } catch {
        // no upstream tracking
      }

      const stableIgnoredSort = (a, b) => {
        if (a.isIgnored === b.isIgnored) return 0
        return a.isIgnored ? 1 : -1
      }
      staged.sort(stableIgnoredSort)
      unstaged.sort(stableIgnoredSort)

      // Backward-compatible flat list, consumed by GitStatusService (file-tree
      // decorations, editor gutter). Unstaged status wins when a file is both
      // staged and further modified in the working tree.
      const flatMap = new Map()
      for (const f of staged) flatMap.set(f.path, f)
      for (const f of unstaged) flatMap.set(f.path, f)
      for (const f of untracked) flatMap.set(f.path, f)
      const files = [...flatMap.values()].sort(stableIgnoredSort)

      const ignored = ignoredPaths.map(p => ({ path: p, status: 'I' }))

      return {
        branch: branch.current,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        ignored,
        files,
        totalAdditions,
        totalDeletions,
        ignoredTracked,
        ignoredPaths,
      }
    } catch {
      return { notARepo: true }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_GET_ROOT, async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      const root = await git.revparse(['--show-toplevel'])
      return root.trim()
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_GET_DIFF, async (_event, rootPath, filePath, opts = {}) => {
    try {
      const git = simpleGit(rootPath)

      if (opts.untracked) {
        const content = await fs.readFile(path.join(rootPath, filePath), 'utf-8')
        return content.split('\n').map(line => `+${line}`).join('\n')
      }

      if (opts.compareTo === 'head') {
        // Combined (staged + unstaged) diff against the last commit — used by
        // the editor gutter, which doesn't track per-file staged/untracked state.
        const status = await git.status()
        if (status.not_added.includes(filePath)) {
          const content = await fs.readFile(path.join(rootPath, filePath), 'utf-8')
          return content.split('\n').map(line => `+${line}`).join('\n')
        }
        return await git.diff(['HEAD', '-M', '--', filePath])
      }

      const args = opts.staged
        ? ['--cached', '-M', '--', filePath]
        : ['-M', '--', filePath]
      const diff = await git.diff(args)
      return diff
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_GET_BRANCHES, async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      const branch = await git.branch()
      return {
        current: branch.current,
        all: branch.all.filter(b => !b.startsWith('remotes/')),
      }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_event, rootPath, branch) => {
    try {
      const git = simpleGit(rootPath)
      await git.checkout(branch)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_CREATE_BRANCH, async (_event, rootPath, name) => {
    try {
      const git = simpleGit(rootPath)
      await git.checkoutLocalBranch(name)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DELETE_BRANCH, async (_event, rootPath, name) => {
    try {
      const git = simpleGit(rootPath)
      await git.deleteLocalBranch(name)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, rootPath, message, opts = {}) => {
    try {
      const git = simpleGit(rootPath)
      if (opts.stageAll) {
        await git.commit(message, undefined, { '-a': null })
      } else {
        await git.commit(message)
      }
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      await git.push()
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      await git.checkout('.')
      await git.clean('f', ['-d'])
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_STAGE, async (_event, rootPath, paths) => {
    try {
      const git = simpleGit(rootPath)
      const list = Array.isArray(paths) ? paths : [paths]
      await git.add(list)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_UNSTAGE, async (_event, rootPath, paths) => {
    try {
      const git = simpleGit(rootPath)
      const list = Array.isArray(paths) ? paths : [paths]
      try {
        await git.raw(['reset', 'HEAD', '--', ...list])
      } catch {
        // No HEAD yet (empty repo) — the file only exists in the index
        await git.raw(['rm', '--cached', '-r', '--', ...list])
      }
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD_FILE, async (_event, rootPath, paths, opts = {}) => {
    try {
      const git = simpleGit(rootPath)
      const list = Array.isArray(paths) ? paths : [paths]

      if (opts.untracked) {
        await git.raw(['clean', '-f', '--', ...list])
      } else {
        try {
          await git.raw(['checkout', 'HEAD', '--', ...list])
        } catch {
          // File has no HEAD counterpart (staged but never committed) —
          // unstage it, then remove it as if it were untracked.
          await git.raw(['reset', 'HEAD', '--', ...list]).catch(() => {})
          await git.raw(['clean', '-f', '--', ...list]).catch(() => {})
        }
      }
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })
}
