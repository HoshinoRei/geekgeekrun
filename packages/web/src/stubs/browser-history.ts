import { isRemoteBrowserConfigured } from '@geekgeekrun/utils/puppeteer/browser-connection.mjs'

export function getBrowserInfo() {
  if (isRemoteBrowserConfigured()) {
    return {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '',
      browserType: 'remote',
      source: 'remote-cdp'
    }
  }
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (!executablePath) {
    return null
  }
  return {
    executablePath,
    browserType: 'chrome',
    source: 'web-server'
  }
}

export async function getLastUsedAndAvailableBrowser() {
  return getBrowserInfo()
}

export async function getAnyAvailablePuppeteerExecutable() {
  return getBrowserInfo()
}

export async function saveLastUsedAndAvailableBrowserInfo() {}