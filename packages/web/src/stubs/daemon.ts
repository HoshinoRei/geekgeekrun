// The desktop build talks to a long-lived daemon over a Unix socket. In the web
// build the server is the parent process, so messages are relayed over the
// Node.js IPC channel instead.
import { EventEmitter } from 'node:events'

export const daemonEE = new EventEmitter()

export async function connectToDaemon() {}

export function sendToDaemon(
  message: Record<string, unknown>,
  { needCallback = false }: { needCallback?: boolean } = {}
) {
  if (typeof process.send === 'function') {
    process.send(message)
  }
  if (needCallback) {
    return Promise.resolve({ workers: [] })
  }
  return undefined
}

export function closeDaemonClient() {}