/**
 * Browser connection strategy shared by the desktop core and the web server:
 *
 *   GEEKGEEKRUN_BROWSER_URL=http://host:9222
 *   GEEKGEEKRUN_BROWSER_WS_ENDPOINT=ws://host:3000?token=...
 *
 * When either endpoint is set, connect to that external Chrome DevTools
 * endpoint. Otherwise launch a local browser (desktop app / local development).
 * Docker deployments always set an endpoint; their image contains no browser.
 *
 * The external browser may be headless (browserless) or headed (VNC image such
 * as lscr.io/linuxserver/chromium). No distinction is needed here.
 */

export function getBrowserConnectionConfig() {
  const browserURL = process.env.GEEKGEEKRUN_BROWSER_URL?.trim() || null
  const browserWSEndpoint = process.env.GEEKGEEKRUN_BROWSER_WS_ENDPOINT?.trim() || null
  return {
    browserURL,
    browserWSEndpoint,
    remoteConfigured: Boolean(browserURL || browserWSEndpoint)
  }
}

export function isRemoteBrowserConfigured () {
  return getBrowserConnectionConfig().remoteConfigured
}

/**
 * @param {import('puppeteer').PuppeteerNode} puppeteer
 * @param {Record<string, unknown>} launchOptions
 */
export async function connectOrLaunchBrowser (puppeteer, launchOptions = {}) {
  const config = getBrowserConnectionConfig()
  if (config.remoteConfigured) {
    const browser = await puppeteer.connect({
      ...(config.browserWSEndpoint
        ? { browserWSEndpoint: config.browserWSEndpoint }
        : { browserURL: config.browserURL }),
      defaultViewport: launchOptions.defaultViewport ?? { width: 1440, height: 900 }
    })
    browser.__ggrRemote = true
    return browser
  }
  return puppeteer.launch(launchOptions)
}

export function isRemoteBrowser (browser) {
  return browser?.__ggrRemote === true
}

/**
 * Closes only the page/session created by this process. For remote browsers the
 * browser itself is left running for the VNC user and other consumers.
 */
export async function disposeBrowser (browser, page) {
  if (!browser) {
    return false
  }
  if (isRemoteBrowser(browser)) {
    try {
      if (page && !page.isClosed()) {
        await page.close()
      }
    } catch {
      // page may already be gone
    }
    try {
      browser.disconnect()
    } catch {
      // already disconnected
    }
    return true
  }
  const debug = process.env.GEEKGEEKRUN_DEBUG_SHUTDOWN === '1'
  if (debug) {
    console.log('[browser] closing local browser', browser.process()?.pid)
  }
  try {
    // Closing the whole browser closes its pages and lets Puppeteer remove the
    // temporary profile. Do not wait on page.close(): it can hang mid-navigation
    // and would block the profile cleanup.
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 6000))
    ])
    if (debug) {
      console.log('[browser] local browser closed')
    }
    // Puppeteer removes its temporary profile on a later tick; give it a moment
    // before callers call process.exit().
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch {
    // ignore
  }
  try {
    const browserProcess = browser.process()
    if (browserProcess) {
      process.kill(browserProcess.pid, 0)
      process.kill(browserProcess.pid, 'SIGKILL')
    }
  } catch {
    // process already gone
  }
  return false
}
