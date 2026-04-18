import simpleGit from 'simple-git'

export function registerGitHandlers(ipcMain) {
  ipcMain.handle('git:get-status', async (_event, rootPath) => {
    try {
      const git = simpleGit(rootPath)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) return { notARepo: true }

      const [status, branch] = await Promise.all([
        git.status(),
        git.branch()
      ])

      const files = []
      let totalAdditions = 0
      let totalDeletions = 0

      const changedFiles = [
        ...status.modified,
        ...status.not_added,
        ...status.created,
        ...status.deleted,
        ...status.renamed.map(r => r.to),
      ]
      const uniqueFiles = [...new Set(changedFiles)]

      for (const filePath of uniqueFiles) {
        try {
          const diff = await git.diff([filePath])
          let additions = 0
          let deletions = 0
          for (const line of diff.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) additions++
            else if (line.startsWith('-') && !line.startsWith('---')) deletions++
          }
          totalAdditions += additions
          totalDeletions += deletions
          files.push({ path: filePath, additions, deletions })
        } catch {
          files.push({ path: filePath, additions: 0, deletions: 0 })
        }
      }

      // Untracked files: count lines as additions
      for (const filePath of status.not_added) {
        const existing = files.find(f => f.path === filePath)
        if (existing && existing.additions === 0) {
          // already counted via diff, skip
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

  ipcMain.handle('git:get-diff', async (_event, rootPath, filePath) => {
    try {
      const git = simpleGit(rootPath)
      const diff = await git.diff([filePath])
      return diff
    } catch (err) {
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
