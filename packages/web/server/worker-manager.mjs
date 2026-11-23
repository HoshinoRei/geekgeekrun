import { fork } from 'node:child_process'
import path from 'node:path'
import { webDistRoot } from './browser.mjs'

const WORKER_ENTRY = {
  geekAutoStartWithBossMain: 'auto-chat-worker.mjs',
  readNoReplyAutoReminderMain: 'read-no-reply-worker.mjs'
}

// Mirrors the desktop daemon: these exits mean "needs user input", everything
// else is an internal crash and the worker is restarted.
const TERMINAL_EXIT_CODES = new Set([0, 81, 82, 83, 84, 85, 86])
const RESTART_DELAY_MS = Number(process.env.MAIN_BOSSGEEKGO_RERUN_INTERVAL) > 0
  ? Number(process.env.MAIN_BOSSGEEKGO_RERUN_INTERVAL)
  : 5000

export class WorkerManager {
  #workers = new Map()
  #broadcast
  #browserEnv
  #logLines = []
  #stopping = new Set()

  constructor({ broadcast, browserEnv }) {
    this.#broadcast = broadcast
    this.#browserEnv = browserEnv
  }

  get(workerId) {
    return this.#workers.get(workerId) ?? null
  }

  list() {
    return [...this.#workers.values()].map((worker) => ({
      workerId: worker.workerId,
      status: 'running',
      restartCount: worker.restartCount,
      uptime: Date.now() - worker.startedAt,
      command: process.execPath,
      args: worker.args,
      pid: worker.child.pid,
      screenshot: undefined,
      screenshotAt: undefined,
      runtimeStorage: {
        stepStatusMapByStepId: {
          'worker-launch': { runRecordId: worker.runRecordId }
        }
      }
    }))
  }

  start(workerId, { runRecordId }) {
    if (this.#workers.has(workerId)) {
      return this.#workers.get(workerId)
    }
    this.#stopping.delete(workerId)
    const entry = WORKER_ENTRY[workerId]
    if (!entry) {
      throw new Error(`UNKNOWN_WORKER_ID: ${workerId}`)
    }
    const args = [`--run-record-id=${runRecordId ?? 0}`]
    const child = fork(path.join(webDistRoot, entry), args, {
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ...this.#browserEnv,
        GEEKGEEKRUND_WORKER_ID: workerId,
        NODE_ENV: 'production'
      }
    })
    const worker = {
      workerId,
      child,
      args,
      runRecordId,
      startedAt: Date.now(),
      restartCount: 0,
      exited: null,
      resolveExit: null
    }
    worker.exited = new Promise((resolve) => {
      worker.resolveExit = resolve
    })
    this.#workers.set(workerId, worker)

    const writeLog = (stream, chunk) => {
      const text = chunk.toString()
      for (const line of text.split(/\r?\n/)) {
        if (!line) {
          continue
        }
        console.log(`[${workerId}] ${line}`)
        this.#logLines.push({ workerId, at: Date.now(), stream, line })
        if (this.#logLines.length > 1000) {
          this.#logLines.shift()
        }
        this.#broadcast('worker-log', { workerId, stream, line })
      }
    }
    child.stdout?.on('data', (chunk) => writeLog('stdout', chunk))
    child.stderr?.on('data', (chunk) => writeLog('stderr', chunk))

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') {
        return
      }
      if (message.type === 'worker-to-gui-message') {
        this.#broadcast('worker-to-gui-message', message)
        if (message.data?.type === 'web-login-required') {
          this.#broadcast('web-login-required', { workerId })
          this.onLoginRequired?.(workerId)
        }
      }
    })

    child.on('error', (error) => {
      console.error(`[${workerId}] failed to start`, error)
      this.#broadcast('toast-message', `任务启动失败：${error.message}`)
    })

    child.on('exit', (code, signal) => {
      console.log(`[${workerId}] exited code=${code} signal=${signal}`)
      this.#workers.delete(workerId)
      const exitCode = typeof code === 'number' ? code : 1
      const shouldRestart = !this.#stopping.has(workerId) && !TERMINAL_EXIT_CODES.has(exitCode)
      this.#broadcast('worker-exited', { workerId, code: exitCode, signal, restarting: shouldRestart })
      if ([81, 82, 85, 86].includes(exitCode)) {
        const messages = {
          81: '登录凭证无效，请重新登录 BOSS 直聘',
          82: '登录状态失效，请重新登录 BOSS 直聘',
          85: '未找到可用的浏览器',
          86: '没有可用的大语言模型，请检查模型配置'
        }
        this.#broadcast('toast-message', messages[exitCode])
      }
      worker.resolveExit?.(exitCode)
      this.onWorkerExit?.(workerId, exitCode)
      if (shouldRestart) {
        setTimeout(() => {
          if (this.#stopping.has(workerId) || this.#workers.has(workerId)) {
            return
          }
          console.log(`[${workerId}] restarting after exit code ${exitCode}`)
          const restarted = this.start(workerId, { runRecordId: worker.runRecordId })
          restarted.restartCount = worker.restartCount + 1
        }, RESTART_DELAY_MS)
      }
    })

    return worker
  }

  async stop(workerId) {
    this.#stopping.add(workerId)
    const worker = this.#workers.get(workerId)
    if (!worker) {
      return
    }
    const { child } = worker
    try {
      // SIGTERM lets the worker close its CDP page before exiting; a remote
      // browser must not be killed, and its tabs should not be left open.
      child.kill('SIGTERM')
    } catch {
      // already gone
    }
    const disconnectTimer = setTimeout(() => {
      try {
        child.disconnect()
      } catch {
        // already disconnected
      }
    }, 5000)
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    }, 12000)
    await Promise.race([worker.exited, new Promise((resolve) => setTimeout(resolve, 14000))])
    clearTimeout(disconnectTimer)
    clearTimeout(killTimer)
  }

  getLogs(limit = 300) {
    return this.#logLines.slice(-limit)
  }

  broadcastToClients(channel, payload) {
    this.#broadcast(channel, payload)
  }

  async stopAll() {
    await Promise.all([...this.#workers.keys()].map((workerId) => this.stop(workerId)))
  }
}