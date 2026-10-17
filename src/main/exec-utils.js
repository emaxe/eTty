import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildChildEnv, findExecutable, getPathValue } from './env-utils.js'

const execFileAsync = promisify(execFile)

/**
 * Запускает программу по имени без `sh`: путь ищется по PATH средствами Node (с PATHEXT на Windows).
 * Windows-шимы `.cmd`/`.bat` (npx, gh, claude из npm) нельзя запускать через execFile напрямую
 * (Node отвечает EINVAL), поэтому для них включается shell; аргументы при этом должны быть
 * фиксированными (не пользовательский ввод) — путь к шиму берётся в кавычки сам.
 * @param {string} name — имя программы (`gh`, `fnm`, `npx`)
 * @param {string[]} args
 * @param {{ resolvedPath?: string, timeout?: number, cwd?: string }} [opts]
 * @returns {Promise<{stdout: string, stderr: string}>}
 * @throws если программа не найдена или завершилась с ошибкой
 */
export async function execProgram(name, args = [], { resolvedPath, timeout = 3000, cwd } = {}) {
  const env = buildChildEnv(process.env, resolvedPath ? { PATH: resolvedPath } : {})
  const file = findExecutable(name, resolvedPath || getPathValue(env))
  if (!file) {
    const err = new Error(`${name}: command not found`)
    err.code = 'ENOENT'
    throw err
  }
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
  return execFileAsync(needsShell ? `"${file}"` : file, args, { timeout, env, cwd, shell: needsShell, windowsHide: true })
}
