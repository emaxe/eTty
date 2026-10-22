/**
 * Сборка нативного аддона тачпада (macOS). На остальных платформах — no-op.
 *   node scripts/build-native.mjs              — под архитектуру хоста (dev, postinstall)
 *   node scripts/build-native.mjs --universal  — arm64 + x64 в одном файле (перед `npm run dist`)
 * Аддон на N-API и собирается против заголовков Node, поэтому от версии Electron не зависит.
 * Если сборка не удалась — приложение работает, просто без жестов тачпада (не роняем install).
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const addonDir = join(root, 'native', 'trackpad')
const outDir = join(addonDir, 'dist')
const gyp = join(root, 'node_modules', '.bin', 'node-gyp')

if (process.platform !== 'darwin') {
  console.log('[native] пропуск: аддон тачпада нужен только на macOS')
  process.exit(0)
}

const universal = process.argv.includes('--universal')
const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64'
const archs = universal ? ['arm64', 'x64'] : [hostArch]

function build(arch) {
  execFileSync(gyp, ['rebuild', `--directory=${addonDir}`, `--arch=${arch}`], { stdio: 'inherit' })
  const out = join(outDir, `trackpad-${arch}.node`)
  copyFileSync(join(addonDir, 'build', 'Release', 'trackpad.node'), out)
  return out
}

try {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const built = archs.map(build)
  const target = join(outDir, 'trackpad.node')
  if (built.length === 1) copyFileSync(built[0], target)
  else execFileSync('lipo', ['-create', '-output', target, ...built], { stdio: 'inherit' })
  console.log(`[native] готово: ${target}`)
} catch (e) {
  console.warn(`[native] сборка аддона тачпада не удалась (жесты тачпада будут недоступны): ${e.message}`)
  if (process.argv.includes('--strict')) process.exit(1)
}
