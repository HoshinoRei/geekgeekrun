import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { getBrowserConnectionConfig } from '@geekgeekrun/utils/puppeteer/browser-connection.mjs'

const require = createRequire(import.meta.url)

export const serverRoot = path.dirname(fileURLToPath(import.meta.url))
export const packageRoot = path.dirname(serverRoot)
export const repoRoot = path.dirname(path.dirname(packageRoot))
export const rendererRoot = path.join(repoRoot, 'packages/ui/out/web-renderer')
export const webDistRoot = path.join(packageRoot, 'web-dist')

export function resolveBrowserExecutable() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv
  }
  try {
    const { default: puppeteer } = require('puppeteer')
    const executablePath = puppeteer.executablePath()
    if (executablePath && fs.existsSync(executablePath)) {
      return executablePath
    }
  } catch {
    // fall through to well-known locations
  }
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome'
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

/**
 * Chromium leaves its temporary user-data dirs behind when a worker is killed.
 * Reap only stale ones so a long-running container does not fill /tmp.
 */
export async function cleanupStalePuppeteerProfiles(maxAgeMs = 2 * 60 * 60 * 1000) {
  const tmpDir = os.tmpdir()
  let removed = 0
  let entries
  try {
    entries = await fs.promises.readdir(tmpDir)
  } catch {
    return removed
  }
  for (const name of entries) {
    if (!/^puppeteer_dev_(chrome_)?profile-/.test(name)) {
      continue
    }
    const target = path.join(tmpDir, name)
    try {
      const stat = await fs.promises.stat(target)
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        await fs.promises.rm(target, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      // profile may be in use or already gone
    }
  }
  return removed
}

export function getBrowserRuntimeInfo() {
  const config = getBrowserConnectionConfig()
  return {
    remoteConfigured: config.remoteConfigured,
    remoteEndpoint: config.browserWSEndpoint ?? config.browserURL
  }
}

export const isHeadless = () => {
  const value = process.env.GEEKGEEKRUN_HEADLESS
  if (value === undefined) {
    return true
  }
  return value === '1' || value === 'true'
}

export function getChromiumArgs() {
  const defaults = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  const extra = (process.env.GEEKGEEKRUN_PUPPETEER_ARGS ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (process.env.GEEKGEEKRUN_NO_SANDBOX === '0') {
    return [...defaults.filter((item) => item !== '--no-sandbox'), ...extra]
  }
  return [...defaults, ...extra]
}