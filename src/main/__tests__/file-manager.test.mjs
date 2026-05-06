import fs from 'fs'
import path from 'path'
import os from 'os'
import { FileManager } from '../file-manager.js'

async function runTest() {
  // Create a temporary directory for testing
  const tmpDirRaw = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-test-'))
  // Resolve real path (macOS /var is a symlink to /private/var)
  const tmpDir = fs.realpathSync(tmpDirRaw)
  const fm = new FileManager()
  fm.setRoot(tmpDir)

  try {
    // Test 1: Normal path inside CWD should pass
    const normalPath = path.join(tmpDir, 'normal-file.txt')
    fs.writeFileSync(normalPath, 'hello')
    const resolvedNormal = await fm.validatePath(normalPath)
    console.log('Test 1 PASS: normal path accepted:', path.relative(tmpDir, resolvedNormal))

    // Test 2: Symlink attack — symlink pointing outside CWD should be rejected
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-outside-'))
    const symlinkPath = path.join(tmpDir, 'evil-link')

    // Create a file outside CWD to point the symlink to
    const outsideFile = path.join(outsideDir, 'secret.txt')
    fs.writeFileSync(outsideFile, 'secret')
    fs.symlinkSync(outsideFile, symlinkPath)

    let attackBlocked = false
    try {
      await fm.validatePath(symlinkPath)
      console.error('Test 2 FAIL: symlink attack NOT blocked')
      process.exit(1)
    } catch (e) {
      if (e.message.includes('Path traversal denied')) {
        console.log('Test 2 PASS: symlink attack blocked')
        attackBlocked = true
      } else {
        console.error('Test 2 FAIL: unexpected error:', e)
        process.exit(1)
      }
    }

    // Test 3: Symlink inside CWD pointing to another file inside CWD should be allowed
    const targetInside = path.join(tmpDir, 'target-inside.txt')
    fs.writeFileSync(targetInside, 'target')
    const goodLink = path.join(tmpDir, 'good-link')
    fs.symlinkSync(targetInside, goodLink)

    const resolvedGood = await fm.validatePath(goodLink)
    console.log('Test 3 PASS: symlink inside CWD accepted:', path.relative(tmpDir, resolvedGood))

    // Test 4: cwdNormalized — path starting with CWD prefix but outside should be rejected
    const evilDir = tmpDir + '-evil'
    fs.mkdirSync(evilDir)
    const evilFile = path.join(evilDir, 'file.txt')
    fs.writeFileSync(evilFile, 'evil')

    let prefixAttackBlocked = false
    try {
      await fm.validatePath(evilFile)
      console.error('Test 4 FAIL: prefix attack NOT blocked')
      process.exit(1)
    } catch (e) {
      if (e.message.includes('Path traversal denied')) {
        console.log('Test 4 PASS: prefix attack blocked')
        prefixAttackBlocked = true
      } else {
        console.error('Test 4 FAIL: unexpected error:', e)
        process.exit(1)
      }
    }

    // Summary
    if (attackBlocked && prefixAttackBlocked) {
      console.log('\n✅ All tests passed')
    } else {
      console.error('\n❌ Some tests failed')
      process.exit(1)
    }
  } finally {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      // Also cleanup any evil-link if it still exists (shouldn't, but just in case)
      const evilLink = path.join(tmpDir, 'evil-link')
      if (fs.existsSync(evilLink)) fs.unlinkSync(evilLink)
    } catch (e) {
      // ignore cleanup errors
    }
  }
}

runTest().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
