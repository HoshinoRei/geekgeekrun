import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import {
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import {
  connectOrLaunchBrowser,
  disposeBrowser,
  isRemoteBrowser,
  isRemoteBrowserConfigured
} from '@geekgeekrun/utils/puppeteer/browser-connection.mjs'

const LOGIN_PAGE_URL = 'https://www.zhipin.com/web/user/'
const LOGIN_SUCCESS_PREFIXES = [
  'https://www.zhipin.com/wapi/zppassport/qrcode/loginConfirm',
  'https://www.zhipin.com/wapi/zppassport/qrcode/dispatcher',
  'https://www.zhipin.com/wapi/zppassport/login/phoneV2'
]
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const VIEWPORT = { width: 1440, height: 900 }

/**
 * Headless BOSS Zhipin QR login: renders the login page in the container and
 * exposes screenshots plus click forwarding to the browser UI.
 */
export class LoginSession {
  #browser = null
  #page = null
  #captureChain = Promise.resolve()
  #status = 'idle'
  #cancelRequested = false
  #error = null
  #startedAt = null
  #timer = null
  #onCookiesCollected
  #executablePath
  #headless
  #args

  constructor({ executablePath, headless, args, onCookiesCollected }) {
    this.#executablePath = executablePath
    this.#headless = headless
    this.#args = args
    this.#onCookiesCollected = onCookiesCollected
  }

  getStatus() {
    const page = this.#page
    return {
      status: this.#status,
      error: this.#error,
      startedAt: this.#startedAt,
      url: page && !page.isClosed() ? page.url() : null,
      hasPage: Boolean(page && !page.isClosed())
    }
  }

  async start() {
    if (['starting', 'waiting'].includes(this.#status)) {
      return this.getStatus()
    }
    this.#status = 'starting'
    this.#cancelRequested = false
    this.#error = null
    this.#startedAt = Date.now()
    this.#timer = setTimeout(() => {
      if (this.#status === 'waiting') {
        this.#status = 'error'
        this.#error = '登录超时（15 分钟），请重新发起登录'
        this.#closeBrowser()
      }
    }, LOGIN_TIMEOUT_MS)
    this.#timer.unref?.()

    try {
      if (!isRemoteBrowserConfigured() && !this.#executablePath) {
        throw new Error('未找到可用的浏览器，请检查 PUPPETEER_EXECUTABLE_PATH')
      }
      const { initPuppeteer } = await import(
        '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
      )
      const { puppeteer } = await initPuppeteer()
      if (process.env.GEEKGEEKRUN_DEBUG_SHUTDOWN === '1') {
        console.log('[login] launching/connecting browser')
      }
      const browser = await connectOrLaunchBrowser(puppeteer, {
        headless: this.#headless,
        executablePath: this.#executablePath ?? undefined,
        args: this.#args,
        ignoreHTTPSErrors: true,
        defaultViewport: VIEWPORT
      })
      this.#browser = browser
      const page = isRemoteBrowser(browser) ? await browser.newPage() : (await browser.pages())[0]
      this.#page = page
      if (process.env.GEEKGEEKRUN_DEBUG_SHUTDOWN === '1') {
        console.log('[login] browser/page ready', { cancelRequested: this.#cancelRequested })
      }
      if (this.#cancelRequested) {
        this.#status = 'canceled'
        this.#closeBrowser()
        return this.getStatus()
      }
      page.once('close', () => {
        if (this.#status === 'waiting') {
          this.#status = 'canceled'
        }
        this.#page = null
      })
      await page.goto(LOGIN_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      if (this.#cancelRequested) {
        this.#status = 'canceled'
        this.#closeBrowser()
        return this.getStatus()
      }
      this.#status = 'waiting'

      // External browsers often keep a persistent profile: if BOSS already
      // considers us logged in, the login page redirects away immediately.
      const landedPath = new URL(page.url()).pathname
      if (!landedPath.startsWith('/web/user') && !landedPath.startsWith('/web/common/security-check')) {
        await this.#collectCookies()
        return this.getStatus()
      }

      const responsePromise = page.waitForResponse(
        (response) => LOGIN_SUCCESS_PREFIXES.some((prefix) => response.url().startsWith(prefix)),
        { timeout: 0 }
      )
      const navigationPromise = page.waitForNavigation({ timeout: 0 }).catch(() => null)
      responsePromise
        .then(async () => {
          if (this.#status !== 'waiting') {
            return
          }
          await Promise.race([navigationPromise, sleep(10000)])
          await this.#collectCookies()
        })
        .catch((error) => {
          if (this.#status === 'waiting') {
            this.#status = 'error'
            this.#error = error?.message ?? String(error)
          }
        })
    } catch (error) {
      this.#status = 'error'
      this.#error = error?.message ?? String(error)
      this.#closeBrowser()
    }
    return this.getStatus()
  }

  async #collectCookies() {
    const page = this.#page
    if (!page) {
      return
    }
    try {
      await sleep(2000)
      const locationEntry = await page.$('.header-home-logo')
      if (locationEntry) {
        await locationEntry.click().catch(() => undefined)
        await Promise.race([page.waitForNavigation({ timeout: 0 }).catch(() => null), sleep(10000)])
      } else {
        await page.goto('https://www.zhipin.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }).catch(() => undefined)
      }
      if (page.url().startsWith('https://www.zhipin.com/web/common/security-check.html')) {
        await Promise.race([page.waitForNavigation({ timeout: 0 }).catch(() => null), sleep(30000)])
      }
      await sleep(2000)
      const [cookies, localStorage] = await Promise.all([
        page.cookies(),
        page
          .evaluate(() => JSON.stringify(window.localStorage))
          .then((value) => JSON.parse(value))
          .catch(() => ({}))
      ])
      if (!Array.isArray(cookies) || !cookies.length) {
        throw new Error('登录成功但未获取到 Cookie，请重试')
      }
      await Promise.all([
        writeStorageFile('boss-cookies.json', cookies),
        writeStorageFile('boss-local-storage.json', localStorage)
      ])
      this.#status = 'success'
      this.#error = null
      this.#onCookiesCollected?.(cookies)
      this.#closeBrowser()
    } catch (error) {
      this.#status = 'error'
      this.#error = error?.message ?? String(error)
      this.#closeBrowser()
    }
  }

  async screenshot() {
    if (!this.#page || this.#page.isClosed()) {
      throw new Error('NO_ACTIVE_LOGIN_SESSION')
    }
    const run = async () => {
      const page = this.#page
      if (!page || page.isClosed()) {
        throw new Error('NO_ACTIVE_LOGIN_SESSION')
      }
      return page.screenshot({ type: 'png', fullPage: false })
    }
    this.#captureChain = this.#captureChain.then(run, run)
    return this.#captureChain
  }

  async click(xRatio, yRatio) {
    const page = this.#page
    if (!page || page.isClosed()) {
      throw new Error('NO_ACTIVE_LOGIN_SESSION')
    }
    const x = Math.max(0, Math.min(1, Number(xRatio) || 0)) * VIEWPORT.width
    const y = Math.max(0, Math.min(1, Number(yRatio) || 0)) * VIEWPORT.height
    await page.mouse.click(x, y)
  }

  async cancel() {
    if (process.env.GEEKGEEKRUN_DEBUG_SHUTDOWN === '1') {
      console.log('[login] cancel requested', { status: this.#status })
    }
    this.#cancelRequested = true
    clearTimeout(this.#timer)
    if (!['success', 'canceled'].includes(this.#status)) {
      this.#status = 'canceled'
    }
    this.#closeBrowser()
    return this.getStatus()
  }

  #closeBrowser() {
    clearTimeout(this.#timer)
    const browser = this.#browser
    const page = this.#page
    this.#browser = null
    this.#page = null
    if (browser) {
      disposeBrowser(browser, page).catch(() => undefined)
    }
  }
}