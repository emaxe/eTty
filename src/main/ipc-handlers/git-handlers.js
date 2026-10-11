import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { parseStatusPorcelainZ, parseNumstat, parseBranchList } from '../git/git-parse.js'

// Maps a porcelain status letter (index or working_dir column) to the badge
// letter shown in the UI. 'C' (copy) and 'T' (typechange) fold into the
// closest equivalent; 'U' marks an unresolved merge conflict.
const STATUS_LETTER_MAP = { A: 'A', M: 'M', D: 'D', R: 'R', C: 'R', T: 'M', U: 'U' }

const asList = (paths) => (Array.isArray(paths) ? paths : [paths])

/**
 * Все git-операции идут через GitRunner (локальный simple-git или `git` по SSH-каналу вкладки),
 * который выбирается по `ctx` — последнему аргументу каждого канала.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ gitRunnerRegistry: import('../git/git-runner-registry.js').GitRunnerRegistry }} deps
 */
export function registerGitHandlers(ipcMain, { gitRunnerRegistry }) {
  ipcMain.handle(IPC_CHANNELS.GIT_GET_STATUS, async (_event, rootPath, ctx) => {
    try {
      const git = gitRunnerRegistry.resolve(rootPath, ctx)
      const raw = await git.run(['status', '--porcelain=v1', '-b', '-z', '-uall'])
      const parsed = parseStatusPorcelainZ(raw)

      const isUntrackedEntry = (f) => f.index === '?' && f.working_dir === '?'
      const trackedFiles = parsed.files.filter(f => !isUntrackedEntry(f))
      const untrackedFiles = parsed.files.filter(isUntrackedEntry)

      const trackedPaths = trackedFiles.map(f => f.path)
      const hasStaged = trackedFiles.some(f => f.index !== ' ')
      const hasUnstaged = trackedFiles.some(f => f.working_dir !== ' ')

      // Игнорируемые каталоги схлопнуты (`-unormal`): `-uall` раскрыл бы node_modules в тысячи путей
      const [ignoredPaths, ignoredTracked, stagedOut, unstagedOut] = await Promise.all([
        git.run(['status', '--porcelain=v1', '-z', '-unormal', '--ignored=traditional'])
          .then(out => parseStatusPorcelainZ(out).ignored)
          .catch(() => []),
        trackedPaths.length > 0 && trackedPaths.length <= 500
          ? git.run(['check-ignore', '--no-index', '--', ...trackedPaths])
              .then(out => out.split('\n').filter(Boolean))
              .catch(() => [])
          : Promise.resolve([]),
        hasStaged ? git.run(['diff', '--numstat', '--cached', '-M']).catch(() => '') : Promise.resolve(''),
        hasUnstaged ? git.run(['diff', '--numstat', '-M']).catch(() => '') : Promise.resolve('')
      ])
      const stagedNumstatMap = parseNumstat(stagedOut)
      const unstagedNumstatMap = parseNumstat(unstagedOut)

      const staged = []
      const unstaged = []
      let totalAdditions = 0
      let totalDeletions = 0

      for (const f of trackedFiles) {
        const isIgnored = ignoredTracked.includes(f.path)
        const isRename = f.index === 'R' || f.index === 'C' || f.working_dir === 'R' || f.working_dir === 'C'

        if (f.index !== ' ') {
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
        if (f.working_dir !== ' ') {
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
        branch: parsed.branch,
        ahead: parsed.ahead,
        behind: parsed.behind,
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

  ipcMain.handle(IPC_CHANNELS.GIT_GET_ROOT, async (_event, rootPath, ctx) => {
    try {
      const git = gitRunnerRegistry.resolve(rootPath, ctx)
      const root = await git.run(['rev-parse', '--show-toplevel'])
      return root.trim()
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_GET_DIFF, async (_event, rootPath, filePath, opts = {}, ctx) => {
    try {
      const git = gitRunnerRegistry.resolve(rootPath, ctx)
      const asAddedLines = (content) => content.split('\n').map(line => `+${line}`).join('\n')

      if (opts.untracked) {
        return asAddedLines(await git.readFile(filePath))
      }

      if (opts.compareTo === 'head') {
        // Combined (staged + unstaged) diff against the last commit — used by
        // the editor gutter, which doesn't track per-file staged/untracked state.
        const out = await git.run(['status', '--porcelain=v1', '-z', '--', filePath])
        if (out.startsWith('?? ')) return asAddedLines(await git.readFile(filePath))
        return await git.run(['diff', 'HEAD', '-M', '--', filePath])
      }

      const args = opts.staged
        ? ['diff', '--cached', '-M', '--', filePath]
        : ['diff', '-M', '--', filePath]
      return await git.run(args)
    } catch {
      return ''
    }
  })

  // Обёртка для мутирующих операций: { ok: true } | { error }
  const mutation = (channel, fn) => {
    ipcMain.handle(channel, async (_event, rootPath, ...rest) => {
      try {
        // ctx — всегда последний аргумент IPC-вызова
        const ctx = rest.length ? rest[rest.length - 1] : undefined
        const git = gitRunnerRegistry.resolve(rootPath, ctx)
        await fn(git, ...rest.slice(0, -1))
        return { ok: true }
      } catch (err) {
        return { error: err.message }
      }
    })
  }

  const assertBranchName = (name) => {
    if (typeof name !== 'string' || !name || name.startsWith('-')) throw new Error('Invalid branch name')
  }

  ipcMain.handle(IPC_CHANNELS.GIT_GET_BRANCHES, async (_event, rootPath, ctx) => {
    try {
      const git = gitRunnerRegistry.resolve(rootPath, ctx)
      return parseBranchList(await git.run(['branch', '--no-color']))
    } catch (err) {
      return { error: err.message }
    }
  })

  mutation(IPC_CHANNELS.GIT_CHECKOUT, async (git, branch) => {
    assertBranchName(branch)
    await git.run(['checkout', branch])
  })

  mutation(IPC_CHANNELS.GIT_CREATE_BRANCH, async (git, name) => {
    assertBranchName(name)
    await git.run(['checkout', '-b', name])
  })

  mutation(IPC_CHANNELS.GIT_DELETE_BRANCH, async (git, name) => {
    assertBranchName(name)
    await git.run(['branch', '-d', name])
  })

  mutation(IPC_CHANNELS.GIT_COMMIT, async (git, message, opts = {}) => {
    await git.run(['commit', ...(opts.stageAll ? ['-a'] : []), '-m', message])
  })

  mutation(IPC_CHANNELS.GIT_PUSH, async (git) => {
    await git.run(['push'])
  })

  mutation(IPC_CHANNELS.GIT_DISCARD, async (git) => {
    await git.run(['checkout', '.'])
    await git.run(['clean', '-f', '-d'])
  })

  mutation(IPC_CHANNELS.GIT_STAGE, async (git, paths) => {
    await git.run(['add', '--', ...asList(paths)])
  })

  mutation(IPC_CHANNELS.GIT_UNSTAGE, async (git, paths) => {
    const list = asList(paths)
    try {
      await git.run(['reset', 'HEAD', '--', ...list])
    } catch {
      // No HEAD yet (empty repo) — the file only exists in the index
      await git.run(['rm', '--cached', '-r', '--', ...list])
    }
  })

  mutation(IPC_CHANNELS.GIT_DISCARD_FILE, async (git, paths, opts = {}) => {
    const list = asList(paths)
    if (opts.untracked) {
      await git.run(['clean', '-f', '--', ...list])
      return
    }
    try {
      await git.run(['checkout', 'HEAD', '--', ...list])
    } catch {
      // File has no HEAD counterpart (staged but never committed) —
      // unstage it, then remove it as if it were untracked.
      await git.run(['reset', 'HEAD', '--', ...list]).catch(() => {})
      await git.run(['clean', '-f', '--', ...list]).catch(() => {})
    }
  })
}
