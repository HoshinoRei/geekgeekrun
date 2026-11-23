import { ipcRenderer } from './ipc'
import { patchWindowClose } from './modal'

// The desktop renderer reads a global `electron` object provided by the preload
// script. Install the same surface before any page module evaluates, because
// several pages destructure it at module scope.
declare global {
  interface Window {
    electron: { ipcRenderer: typeof ipcRenderer }
    webApi: unknown
  }
}

window.electron = { ipcRenderer }
patchWindowClose()