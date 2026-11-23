import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { webDistRoot } from './browser.mjs'

export function createDbClient() {
  let worker = null
  let initPromise = null
  const pending = new Map()

  function init() {
    if (initPromise) {
      return initPromise
    }
    initPromise = new Promise((resolve, reject) => {
      worker = new Worker(pathToFileURL(path.join(webDistRoot, 'db-worker.cjs')))
      worker.on('message', (message) => {
        if (message.type === 'DB_INIT_SUCCESS') {
          resolve(worker)
          return
        }
        if (message.type === 'DB_INIT_FAIL') {
          worker?.terminate()
          reject(new Error(`DB init failed: ${message.error}`))
          return
        }
        const request = pending.get(message._uuid)
        if (!request) {
          return
        }
        pending.delete(message._uuid)
        if (message.error) {
          request.reject(new Error(message.error))
        } else {
          request.resolve(message.data)
        }
      })
      worker.on('error', (error) => {
        reject(error)
        for (const request of pending.values()) {
          request.reject(error)
        }
        pending.clear()
      })
      worker.on('exit', (code) => {
        if (code !== 0) {
          const error = new Error(`DB worker exited with code ${code}`)
          reject(error)
          for (const request of pending.values()) {
            request.reject(error)
          }
          pending.clear()
        }
        worker = null
        initPromise = null
      })
    })
    return initPromise
  }

  async function call(type, payload = {}) {
    await init()
    const uuid = randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(uuid, { resolve, reject })
      worker.postMessage({ _uuid: uuid, type, ...payload })
    })
  }

  function close() {
    worker?.terminate()
  }

  return { call, close }
}