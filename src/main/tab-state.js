import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, unlink, access } from 'fs/promises'
import log from 'electron-log'

const STATE_FILE = () => join(app.getPath('userData'), 'tabs-state.json')
const STATE_VERSION = 2

export async function saveTabState(tabs) {
  const data = {
    version: STATE_VERSION,
    tabs: tabs.filter(t => t.rootPath),
    savedAt: new Date().toISOString()
  }
  try {
    await writeFile(STATE_FILE(), JSON.stringify(data, null, 2), 'utf-8')
    log.info('tab-state: saved', data.tabs.length, 'tabs')
  } catch (e) {
    log.error('tab-state: failed to save', e.message)
  }
}

export async function loadTabState() {
  try {
    const raw = await readFile(STATE_FILE(), 'utf-8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data.tabs)) return null
    // Backward compat: version 1 tabs lack tabId — generate UUIDs
    if (data.version === 1) {
      data.tabs = data.tabs.map(t => ({ ...t, tabId: t.tabId || crypto.randomUUID() }))
      data.version = STATE_VERSION
    }
    if (data.version !== STATE_VERSION) return null
    return data
  } catch {
    return null
  }
}

export async function deleteTabState() {
  try {
    await unlink(STATE_FILE())
  } catch {
    // file may not exist
  }
}

export async function hasTabState() {
  try {
    await access(STATE_FILE())
    return true
  } catch {
    return false
  }
}

export async function validatePath(dirPath) {
  try {
    await access(dirPath)
    return true
  } catch {
    return false
  }
}
