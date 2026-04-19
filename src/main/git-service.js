import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'

function countDiffLines(diff) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

export function registerGitHandlers(ipcMain) {
  ipcMain.handle('git:get-status', async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      const isRepo = await git.checkIsRepo()
      console.log('[git-panel] get-status rootPath:', rootPath, 'isRepo:', isRepo)
      if (!isRepo) return { notARepo: true }

      const [status, branch] = await Promise.all([
        git.status(),
        git.branch()
      ])
      console.log('[git-panel] status modified:', status.modified, 'not_added:', status.not_added, 'deleted:', status.deleted)

      const files = []
      let totalAdditions = 0
      let totalDeletions = 0

      // Modified tracked files
      for (const filePath of status.modified) {
        try {
          const diff = await git.diff(['HEAD', '--', filePath])
          const { additions, deletions } = countDiffLines(diff)
          totalAdditions += additions
          totalDeletions += deletions
          files.push({ path: filePath, additions, deletions })
        } catch {
          files.push({ path: filePath, additions: 0, deletions: 0 })
        }
      }

      // Untracked files: all lines are additions
      for (const filePath of status.not_added) {
        try {
          const content = await fs.readFile(path.join(rootPath, filePath), 'utf-8')
          const additions = content ? content.replace(/\n$/, '').split('\n').length : 0
          totalAdditions += additions
          files.push({ path: filePath, additions, deletions: 0, untracked: true })
        } catch {
          files.push({ path: filePath, additions: 0, deletions: 0, untracked: true })
        }
      }

      // Staged new files
      for (const filePath of status.created) {
        try {
          const diff = await git.diff(['--cached', filePath])
          const { additions, deletions } = countDiffLines(diff)
          totalAdditions += additions
          totalDeletions += deletions
          files.push({ path: filePath, additions, deletions })
        } catch {
          files.push({ path: filePath, additions: 0, deletions: 0 })
        }
      }

      // Deleted files
      for (const filePath of status.deleted) {
        try {
          const diff = await git.diff(['HEAD', '--', filePath])
          const { additions, deletions } = countDiffLines(diff)
          totalAdditions += additions
          totalDeletions += deletions
          files.push({ path: filePath, additions, deletions })
        } catch {
          files.push({ path: filePath, additions: 0, deletions: 0 })
        }
      }

      // Renamed files
      for (const rename of status.renamed) {
        try {
          const diff = await git.diff([rename.to])
          const { additions, deletions } = countDiffLines(diff)
          totalAdditions += additions
          totalDeletions += deletions
          files.push({ path: rename.to, additions, deletions })
        } catch {
          files.push({ path: rename.to, additions: 0, deletions: 0 })
        }
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

      return {
        branch: branch.current,
        ahead,
        behind,
        files,
        totalAdditions,
        totalDeletions,
      }
    } catch {
      return { notARepo: true }
    }
  })

  ipcMain.handle('git:get-root', async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      const root = await git.revparse(['--show-toplevel'])
      return root.trim()
    } catch {
      return null
    }
  })

  ipcMain.handle('git:get-diff', async (_event, rootPath, filePath) => {
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

  ipcMain.handle('git:get-branches', async (_event, rootPath) => {
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

  ipcMain.handle('git:checkout', async (_event, rootPath, branch) => {
    try {
      const git = simpleGit(rootPath)
      await git.checkout(branch)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('git:create-branch', async (_event, rootPath, name) => {
    try {
      const git = simpleGit(rootPath)
      await git.checkoutLocalBranch(name)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('git:delete-branch', async (_event, rootPath, name) => {
    try {
      const git = simpleGit(rootPath)
      await git.deleteLocalBranch(name)
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('git:commit', async (_event, rootPath, message) => {
    try {
      const git = simpleGit(rootPath)
      await git.commit(message, undefined, { '-a': null })
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('git:push', async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      await git.push()
      return { ok: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('git:discard', async (_event, rootPath) => {
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
