import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createIpcHandlers,
  readPromptFile,
  writePromptFile
} from './ipc-handlers.mjs'
import { createDbClient } from './db.mjs'
import { WorkerManager } from './worker-manager.mjs'
import { LoginSession } from './login-session.mjs'
import { SiteSession } from './site-session.mjs'
import {
  cleanupStalePuppeteerProfiles,
  getBrowserRuntimeInfo,
  getChromiumArgs,
  isHeadless,
  resolveBrowserExecutable,
  webDistRoot
} from './browser.mjs'
import { readJsonBody, resolveStaticFile, sendJson, sendStaticFile } from './static.mjs'
import {
  ensureConfigFileExist,
  ensureStorageFileExist,
  readConfigFile,
  readStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import buildInfo from '../../ui/src/common/build-info.json' with { type: 'json' }

const PORT = Number(process.env.PORT) || 3210
const HOST = process.env.HOST || '0.0.0.0'
const AUTH_TOKEN = process.env.GEEKGEEKRUN_AUTH_TOKEN || ''

ensureConfigFileExist()
ensureStorageFileExist()

const browserRuntime = getBrowserRuntimeInfo()
const browserExecutablePath = browserRuntime.remoteConfigured ? null : resolveBrowserExecutable()
if (browserRuntime.remoteConfigured) {
  process.env.PUPPETEER_EXECUTABLE_PATH = ''
} else if (browserExecutablePath) {
  process.env.PUPPETEER_EXECUTABLE_PATH = browserExecutablePath
} else {
  console.error(
    '[web] no external browser configured and no local Chromium found; set GEEKGEEKRUN_BROWSER_URL or GEEKGEEKRUN_BROWSER_WS_ENDPOINT'
  )
}

if (!browserRuntime.remoteConfigured && process.env.GEEKGEEKRUN_CLEAN_STALE_PROFILES !== '0') {
  const cleanProfiles = () => {
    cleanupStalePuppeteerProfiles().then((removed) => {
      if (removed) {
        console.log(`[web] removed ${removed} stale Chromium profile(s) from ${os.tmpdir()}`)
      }
    })
  }
  cleanProfiles()
  setInterval(cleanProfiles, 6 * 60 * 60 * 1000).unref()
}

if (!fs.existsSync(path.join(webDistRoot, 'auto-chat-worker.mjs'))) {
  console.error('[web] worker bundles are missing; run `pnpm run build` in packages/web')
  process.exit(1)
}

const clients = new Set()
const recentEvents = []
const MAX_RECENT_EVENTS = 500

function writeEvent(stream, channel, payload) {
  stream.write(`event: ${channel}\ndata: ${JSON.stringify(payload ?? null)}\n\n`)
}

function broadcast(channel, payload) {
  const event = { type: channel, payload, at: Date.now() }
  recentEvents.push(event)
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.shift()
  }
  for (const client of clients) {
    writeEvent(client, channel, payload)
  }
}

const db = createDbClient()
const workerManager = new WorkerManager({
  broadcast,
  browserEnv: {
    PUPPETEER_EXECUTABLE_PATH: browserExecutablePath ?? '',
    GEEKGEEKRUN_HEADLESS: isHeadless() ? '1' : '0',
    GEEKGEEKRUN_PUPPETEER_ARGS: getChromiumArgs().join(' ')
  }
})

const loginSession = new LoginSession({
  executablePath: browserExecutablePath,
  headless: isHeadless(),
  args: getChromiumArgs(),
  onCookiesCollected: (cookies) => {
    loginSessionOwner = null
    broadcast('BOSS_ZHIPIN_COOKIE_COLLECTED', { cookies })
    broadcast('toast-message', 'BOSS 直聘登录成功，登录凭证已保存')
  }
})

const siteSession = new SiteSession({
  executablePath: browserExecutablePath,
  headless: isHeadless(),
  args: getChromiumArgs()
})

const browserInfo = browserRuntime.remoteConfigured
  ? {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '',
      browserType: 'remote',
      source: 'web-server'
    }
  : browserExecutablePath
    ? {
        executablePath: browserExecutablePath,
        browserType: 'chrome',
        source: 'web-server'
      }
    : null

const { invoke, send } = createIpcHandlers({
  db,
  workerManager,
  loginSession,
  browserInfo
})

let loginSessionOwner = null

workerManager.onLoginRequired = (workerId) => {
  loginSessionOwner = workerId
  loginSession.start()
}

// A login popup started because a worker needed cookies belongs to that worker;
// stopping/ending the task closes it, matching the desktop window behaviour.
workerManager.onWorkerExit = (workerId) => {
  if (loginSessionOwner !== workerId) {
    return
  }
  loginSessionOwner = null
  if (['starting', 'waiting'].includes(loginSession.getStatus().status)) {
    loginSession.cancel().catch(() => undefined)
  }
}

function checkAuth(req) {
  if (!AUTH_TOKEN) {
    return true
  }
  const header = req.headers.authorization ?? ''
  if (header === `Bearer ${AUTH_TOKEN}`) {
    return true
  }
  const cookie = req.headers.cookie ?? ''
  const expected = `ggr_token=${encodeURIComponent(AUTH_TOKEN)}`
  return cookie.split(/;\s*/).some((item) => item === expected)
}

function unauthorized(res) {
  sendJson(res, 401, { error: 'UNAUTHORIZED' })
}

const PUBLIC_API_PATHS = new Set(['/api/env', '/api/login'])

async function handleApi(req, res, urlPath) {
  if (!PUBLIC_API_PATHS.has(urlPath) && !checkAuth(req)) {
    unauthorized(res)
    return
  }

  if (urlPath === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.write('retry: 3000\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (urlPath === '/api/env') {
    sendJson(res, 200, {
      authRequired: Boolean(AUTH_TOKEN),
      remoteBrowserConfigured: browserRuntime.remoteConfigured,
      browserExecutablePath,
      headless: isHeadless(),
      buildInfo
    })
    return
  }

  if (urlPath === '/api/login') {
    const token = req.headers['x-auth-token']
    if (AUTH_TOKEN && token !== AUTH_TOKEN) {
      unauthorized(res)
      return
    }
    if (!AUTH_TOKEN) {
      sendJson(res, 200, { ok: true, authRequired: false })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `ggr_token=${encodeURIComponent(AUTH_TOKEN)}; Path=/; HttpOnly; SameSite=Lax`
    })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (urlPath === '/api/ipc/invoke') {
    const body = await readJsonBody(req)
    try {
      const result = await invoke(body?.channel, body?.args ?? [])
      sendJson(res, 200, { result })
    } catch (error) {
      sendJson(res, 200, {
        error: { message: error?.message ?? String(error), name: error?.name ?? 'Error' }
      })
    }
    return
  }

  if (urlPath === '/api/ipc/send') {
    const body = await readJsonBody(req)
    await send(body?.channel, body?.args ?? [])
    sendJson(res, 200, { result: null })
    return
  }

  if (urlPath === '/api/login-session/start') {
    sendJson(res, 200, await loginSession.start())
    return
  }

  if (urlPath === '/api/login-session/status') {
    sendJson(res, 200, loginSession.getStatus())
    return
  }

  if (urlPath === '/api/login-session/screenshot') {
    try {
      const buffer = await loginSession.screenshot()
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': buffer.length
      })
      res.end(buffer)
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/login-session/click') {
    const body = await readJsonBody(req)
    try {
      await loginSession.click(body?.x, body?.y)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/login-session/cancel') {
    sendJson(res, 200, await loginSession.cancel())
    return
  }

  if (urlPath === '/api/site-session/open') {
    const body = await readJsonBody(req)
    try {
      sendJson(res, 200, await siteSession.open(body?.url))
    } catch (error) {
      sendJson(res, 200, { status: 'error', error: error.message })
    }
    return
  }

  if (urlPath === '/api/site-session/status') {
    sendJson(res, 200, siteSession.getStatus())
    return
  }

  if (urlPath === '/api/site-session/screenshot') {
    try {
      const buffer = await siteSession.screenshot()
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'Content-Length': buffer.length
      })
      res.end(buffer)
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/site-session/click') {
    const body = await readJsonBody(req)
    try {
      await siteSession.click(body?.x, body?.y)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/site-session/type') {
    const body = await readJsonBody(req)
    try {
      await siteSession.type(body?.text)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/site-session/key') {
    const body = await readJsonBody(req)
    try {
      await siteSession.key(body?.key)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/site-session/save-cookies') {
    try {
      const cookies = await siteSession.saveCookies()
      broadcast('BOSS_ZHIPIN_COOKIE_COLLECTED', { cookies })
      broadcast('toast-message', '当前页面的 BOSS 直聘 Cookie 已保存')
      sendJson(res, 200, { ok: true, count: cookies.length })
    } catch (error) {
      sendJson(res, 404, { error: error.message })
    }
    return
  }

  if (urlPath === '/api/site-session/close') {
    await siteSession.close()
    sendJson(res, 200, { ok: true })
    return
  }

  if (urlPath === '/api/prompt') {
    const type = new URL(req.url, 'http://localhost').searchParams.get('type')
    if (req.method === 'GET') {
      sendJson(res, 200, await readPromptFile(type))
      return
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      await writePromptFile(type, String(body?.content ?? ''))
      sendJson(res, 200, { ok: true })
      return
    }
  }

  if (urlPath === '/api/workers/logs') {
    sendJson(res, 200, { logs: workerManager.getLogs() })
    return
  }

  if (urlPath === '/api/workers') {
    sendJson(res, 200, { workers: workerManager.list() })
    return
  }

  if (urlPath === '/api/config') {
    sendJson(res, 200, {
      config: Object.fromEntries(
        ['boss.json', 'dingtalk.json', 'target-company-list.json', 'llm.json', 'common-job-condition-config.json']
          .map((fileName) => [fileName, readConfigFile(fileName)])
      ),
      cookiesValid: Boolean(readStorageFile('boss-cookies.json')?.length)
    })
    return
  }

  sendJson(res, 404, { error: 'NOT_FOUND' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname)
      return
    }
    const filePath = resolveStaticFile(url.pathname)
    if (!filePath) {
      const fallback = resolveStaticFile('/')
      if (fallback && !path.extname(url.pathname)) {
        sendStaticFile(res, fallback)
      } else {
        sendJson(res, 404, { error: 'NOT_FOUND' })
      }
      return
    }
    sendStaticFile(res, filePath)
  } catch (error) {
    console.error('[web] request failed', error)
    if (!res.headersSent) {
      sendJson(res, 500, { error: error?.message ?? 'INTERNAL_ERROR' })
    } else {
      res.end()
    }
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[web] GeekGeekRun web control panel listening on http://${HOST}:${PORT}`)
  console.log(
    `[web] browser: ${
      browserRuntime.remoteConfigured
        ? `external ${browserRuntime.remoteEndpoint}`
        : browserExecutablePath ?? 'none'
    }, headless: ${isHeadless()}`
  )
})

let shuttingDown = false

async function shutdown() {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log('[web] shutting down')
  server.close()
  broadcast('web-shutting-down', null)
  clients.forEach((client) => client.end())
  await loginSession.cancel()
  await siteSession.close()
  await workerManager.stopAll()
  db.close()
  setTimeout(() => process.exit(0), 500)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('uncaughtException', (error) => {
  console.error('[web] uncaughtException', error)
})
process.on('unhandledRejection', (error) => {
  console.error('[web] unhandledRejection', error)
})