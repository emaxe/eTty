import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  ptyCreate: (options) => ipcRenderer.invoke('pty:create', options),
  ptyWrite: (pid, data) => ipcRenderer.send('pty:write', { pid, data }),
  ptyResize: (pid, cols, rows) => ipcRenderer.send('pty:resize', { pid, cols, rows }),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_, data) => cb(data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_, info) => cb(info)),
  getHomedir: () => ipcRenderer.invoke('app:homedir')
})
