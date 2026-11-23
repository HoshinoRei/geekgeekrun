// Minimal Electron surface for running the desktop worker code under plain Node.
// Only the APIs touched by the worker import graph are implemented.

const noop = () => undefined

export class BrowserWindow {
  static fromWebContents() {
    return null
  }
  static getAllWindows() {
    return []
  }
  webContents = {
    send: noop,
    on: noop,
    setWindowOpenHandler: noop
  }
  on() {
    return this
  }
  once() {
    return this
  }
  show() {
    return this
  }
  close() {
    return this
  }
  isDestroyed() {
    return false
  }
  loadURL() {
    return Promise.resolve()
  }
  loadFile() {
    return Promise.resolve()
  }
  setMinimumSize() {}
  setSize() {}
}

export const app = {
  name: 'GeekGeekRun',
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  on: noop,
  once: noop,
  exit(code = 0) {
    process.exit(code)
  },
  quit() {
    process.exit(0)
  },
  getPath: () => process.cwd(),
  requestSingleInstanceLock: () => true,
  dock: {
    hide: noop,
    show: noop
  }
}

export const dialog = {
  async showMessageBox(options: { message?: string; detail?: string } = {}) {
    console.log(`[dialog] ${options.message ?? ''}${options.detail ? `: ${options.detail}` : ''}`)
    return { response: 0 }
  },
  async showOpenDialog() {
    return { canceled: true, filePaths: [] }
  }
}

export const ipcMain = {
  on: noop,
  once: noop,
  handle: noop,
  removeHandler: noop,
  off: noop
}

export const ipcRenderer = {
  on: noop,
  once: noop,
  send: noop,
  async invoke() {
    return undefined
  },
  removeListener: noop
}

export const shell = {
  async openExternal() {},
  async openPath() {
    return ''
  }
}

export const globalShortcut = {
  register: noop,
  unregister: noop
}

export const Menu = {
  setApplicationMenu: noop,
  buildFromTemplate: () => ({})
}

export const nativeImage = {
  createFromPath: () => ({})
}

export const clipboard = {
  writeText: noop
}

export default {
  app,
  dialog,
  ipcMain,
  ipcRenderer,
  BrowserWindow,
  shell,
  globalShortcut,
  Menu,
  nativeImage,
  clipboard
}