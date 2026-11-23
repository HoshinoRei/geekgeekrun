export interface IpcRendererEvent {
  senderId?: number
}

type Listener = (event: IpcRendererEvent, ...args: unknown[]) => void

async function requestJson(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('ggr:unauthorized'))
  }
  return response
}

const listeners = new Map<string, Set<Listener>>()

function emit(channel: string, payload: unknown) {
  const set = listeners.get(channel)
  if (!set) {
    return
  }
  for (const listener of [...set]) {
    try {
      listener({ senderId: 0 }, payload)
    } catch (error) {
      console.error(`[web-ipc] listener for ${channel} failed`, error)
    }
  }
}

let eventSource: EventSource | null = null
function ensureEventStream() {
  if (eventSource) {
    return
  }
  eventSource = new EventSource('/api/events')
  const channels = [
    'worker-to-gui-message',
    'worker-exited',
    'worker-log',
    'toast-message',
    'common-job-condition-config-updated',
    'need-to-check-runtime-dependencies',
    'BOSS_ZHIPIN_COOKIE_COLLECTED',
    'BOSS_ZHIPIN_LOGIN_PAGE_CLOSED',
    'geek-auto-start-chat-with-boss-stopping',
    'geek-auto-start-chat-with-boss-stopped',
    'read-no-reply-auto-reminder-stopping',
    'read-no-reply-auto-reminder-stopped',
    'web-login-required',
    'web-shutting-down'
  ]
  for (const channel of channels) {
    eventSource.addEventListener(channel, (event) => {
      let payload: unknown = null
      try {
        payload = JSON.parse((event as MessageEvent).data)
      } catch {
        payload = (event as MessageEvent).data
      }
      emit(channel, payload)
    })
  }
}

export async function baseInvoke(channel: string, ...args: unknown[]) {
  ensureEventStream()
  const response = await requestJson('/api/ipc/invoke', {
    method: 'POST',
    body: JSON.stringify({ channel, args })
  })
  const body = await response.json()
  if (body?.error) {
    const message =
      typeof body.error === 'string' ? body.error : (body.error.message ?? 'IPC error')
    const error = new Error(message)
    if (typeof body.error !== 'string') {
      error.name = body.error.name ?? 'Error'
    }
    throw error
  }
  return body?.result
}

export function baseSend(channel: string, ...args: unknown[]) {
  ensureEventStream()
  return requestJson('/api/ipc/send', {
    method: 'POST',
    body: JSON.stringify({ channel, args })
  }).catch((error) => console.error(`[web-ipc] send ${channel} failed`, error))
}

export function dispatchLocal(channel: string, payload: unknown) {
  emit(channel, payload)
}

export const ipcRenderer = {
  invoke: baseInvoke,
  send: baseSend,
  on(channel: string, listener: Listener) {
    ensureEventStream()
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  },
  once(channel: string, listener: Listener) {
    const off = ipcRenderer.on(channel, (event, ...args) => {
      off()
      listener(event, ...args)
    })
    return off
  },
  removeListener(channel: string, listener: Listener) {
    listeners.get(channel)?.delete(listener)
  },
  removeAllListeners(channel?: string) {
    if (channel) {
      listeners.delete(channel)
    } else {
      listeners.clear()
    }
  }
}

export interface WebApi {
  loginSession: {
    start: () => Promise<{ status: string; error?: string }>
    status: () => Promise<{
      status: string
      error?: string
      hasPage: boolean
      startedAt?: number
    }>
    click: (x: number, y: number) => Promise<unknown>
    cancel: () => Promise<{ status: string }>
  }
  env: () => Promise<{
    remoteBrowserConfigured: boolean
    browserExecutablePath: string | null
    headless: boolean
  }>
  prompt: {
    get: (type: string) => Promise<{ fileName: string; content: string }>
    write: (type: string, content: string) => Promise<{ ok: boolean }>
  }
}

export const webApi: WebApi = {
  loginSession: {
    start: () => requestJson('/api/login-session/start', { method: 'POST' }).then((r) => r.json()),
    status: () => requestJson('/api/login-session/status').then((r) => r.json()),
    click: (x: number, y: number) =>
      requestJson('/api/login-session/click', {
        method: 'POST',
        body: JSON.stringify({ x, y })
      }).then(async (response) => {
        const body = await response.json()
        if (body?.error) {
          throw new Error(body.error)
        }
        return body
      }),
    cancel: () => requestJson('/api/login-session/cancel', { method: 'POST' }).then((r) => r.json())
  },
  env: () => requestJson('/api/env').then((r) => r.json()),
  prompt: {
    get: (type: string) =>
      requestJson(`/api/prompt?type=${encodeURIComponent(type)}`).then((r) => r.json()),
    write: (type: string, content: string) =>
      requestJson(`/api/prompt?type=${encodeURIComponent(type)}`, {
        method: 'PUT',
        body: JSON.stringify({ content })
      }).then((r) => r.json())
  }
}

export type WebIpcRenderer = typeof ipcRenderer

declare global {
  interface Window {
    webApi?: WebApi
  }
}
