import simpleGit from 'simple-git'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

const MAX_UNTRACKED_SIZE = 50 * 1024 * 1024 // 50 MB
const MAX_UNTRACKED_COUNT = 200

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
      const filePath = parts.slice(2).join('\t')
      map.set(filePath, { additions, deletions })
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

      const trackedPaths = [
        ...status.modified,
        ...status.deleted,
        ...status.created,
        ...status.renamed.map(r => r.to),
      ]

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
        const porcelain = await git.raw(['status', '--porcelain', '--ignored=matching'])
        ignoredPaths = porcelain
          .split('\n')
          .filter(line => line.startsWith('!! '))
          .map(line => line.slice(3).trim())
      } catch {
        ignoredPaths = []
      }

      const files = []
      let totalAdditions = 0
      let totalDeletions = 0

      // 1. Tracked changes against HEAD (modified, deleted, renamed) — single diff --numstat HEAD
      const hasTrackedChanges = status.modified.length > 0 || status.deleted.length > 0 || status.renamed.length > 0
      let headNumstatMap = new Map()
      if (hasTrackedChanges) {
        const headNumstat = await git.raw(['diff', '--numstat', 'HEAD'])
        headNumstatMap = parseNumstat(headNumstat)
      }

      for (const filePath of status.modified) {
        const stats = headNumstatMap.get(filePath) || { additions: 0, deletions: 0 }
        const isIgnored = ignoredTracked.includes(filePath)
        totalAdditions += stats.additions
        totalDeletions += stats.deletions
        files.push({ path: filePath, additions: stats.additions, deletions: stats.deletions, status: 'M', isIgnored })
      }

      for (const filePath of status.deleted) {
        const stats = headNumstatMap.get(filePath) || { additions: 0, deletions: 0 }
        const isIgnored = ignoredTracked.includes(filePath)
        totalAdditions += stats.additions
        totalDeletions += stats.deletions
        files.push({ path: filePath, additions: stats.additions, deletions: stats.deletions, status: 'D', isIgnored })
      }

      // Renamed files are rare; keep per-file accuracy
      for (const rename of status.renamed) {
        let stats = { additions: 0, deletions: 0 }
        try {
          const diff = await git.raw(['diff', '--numstat', 'HEAD', '--', rename.to])
          const parsed = parseNumstat(diff)
          const found = parsed.get(rename.to)
          if (found) stats = found
        } catch {
          // ignore
        }
        const isIgnored = ignoredTracked.includes(rename.to)
        totalAdditions += stats.additions
        totalDeletions += stats.deletions
        files.push({ path: rename.to, additions: stats.additions, deletions: stats.deletions, status: 'R', isIgnored })
      }

      // 2. Staged new files — single diff --numstat --cached
      let stagedNumstatMap = new Map()
      if (status.created.length > 0) {
        const stagedNumstat = await git.raw(['diff', '--numstat', '--cached'])
        stagedNumstatMap = parseNumstat(stagedNumstat)
      }

      for (const filePath of status.created) {
        const stats = stagedNumstatMap.get(filePath) || { additions: 0, deletions: 0 }
        const isIgnored = ignoredTracked.includes(filePath)
        totalAdditions += stats.additions
        totalDeletions += stats.deletions
        files.push({ path: filePath, additions: stats.additions, deletions: stats.deletions, status: 'A', isIgnored })
      }

      // 3. Untracked files — stream-count lines, capped by size/count to avoid OOM/hang
      async function countLines(filePath) {
        return new Promise((resolve, reject) => {
          let count = 0
          const stream = createReadStream(filePath)
          stream.on('data', (chunk) => {
            for (let i = 0; i < chunk.length; i++) {
              if (chunk[i] === 0x0A) count++
            }
          })
          stream.on('end', () => resolve(count))
          stream.on('error', reject)
        })
      }

      const untrackedFiles = status.not_added.slice(0, MAX_UNTRACKED_COUNT)
      await Promise.all(untrackedFiles.map(async (filePath) => {
        const fullPath = path.join(rootPath, filePath)
        try {
          const st = await fs.stat(fullPath)
          if (!st.isFile() || st.size > MAX_UNTRACKED_SIZE) {
            files.push({ path: filePath, additions: 0, deletions: 0, untracked: true, status: '?' })
            return
          }
          const additions = await countLines(fullPath)
          totalAdditions += additions
          files.push({ path: filePath, additions, deletions: 0, untracked: true, status: '?' })
        } catch {
          files.push({ path: filePath, additions: 0, deletions: 0, untracked: true, status: '?' })
        }
      }))

      if (status.not_added.length > MAX_UNTRACKED_COUNT) {
        console.warn(`[git-panel] Truncated untracked files: ${status.not_added.length} > ${MAX_UNTRACKED_COUNT}`)
      }

      let ahead = 0
      let behind = 0
      try {
        const trackingInfo = await git.raw(['rev-list', '--left-right', '--count', `${branch.current}...@{u}`])
        const parts = trackingInfo.trim().split('\t')
        if (parts.length === 2) {
          ahead = parseInt(parts[0], 10) || 0
          behind = parseInt(parts[1], 10) || 0
        }
      } catch {
        // no upstream tracking
      }

      const stableIgnoredSort = (a, b) => {
        if (a.isIgnored === b.isIgnored) return 0
        return a.isIgnored ? 1 : -1
      }
      files.sort(stableIgnoredSort)

      return {
        branch: branch.current,
        ahead,
        behind,
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

  ipcMain.handle(IPC_CHANNELS.GIT_GET_DIFF, async (_event, rootPath, filePath) => {
    try {
      const git = simpleGit(rootPath)
      const status = await git.status()
      const isUntracked = status.not_added.includes(filePath)

      if (isUntracked) {
        const content = await fs.readFile(path.join(rootPath, filePath), 'utf-8')
        return content.split('\n').map(line => `+${line}`).join('\n')
      }

      const diff = await git.diff(['HEAD', '--', filePath])
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

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, rootPath, message) => {
    try {
      const git = simpleGit(rootPath)
      await git.commit(message, undefined, { '-a': null })
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
}
