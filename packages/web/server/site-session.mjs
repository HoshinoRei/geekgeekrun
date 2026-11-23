import {
  readStorageFile,
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import {
  connectOrLaunchBrowser,
  disposeBrowser,
  isRemoteBrowser,
  isRemoteBrowserConfigured
} from '@geekgeekrun/utils/puppeteer/browser-connection.mjs'

const LOCAL_STORAGE_PAGE_URL = 'https://www.zhipin.com/desktop/'
const VIEWPORT = { width: 1280, height: 800 }

/**
 * A single headless page streamed to the web UI. Used for "手动逛 BOSS" and the
 * job/company detail links, which open a dedicated Electron window on desktop.
 */
export class SiteSession {
  #browser = null
  #page = null
  #status = 'idle'
  #error = null
  #executablePath
  #headless
  #args
  #captureChain = Promise.resolve()

  constructor({ executablePath, headless, args }) {
    this.#executablePath = executablePath
    this.#headless = headless
    this.#args = args
  }

  getStatus() {
    const page = this.#page
    return {
      status: this.#status,
      error: this.#error,
      url: page && !page.isClosed() ? page.url() : null,
      title: page && !page.isClosed() ? this.#title : null,
      hasPage: Boolean(page && !page.isClosed())
    }
  }

  #title = null

  async open(url) {
    if (!/^https?:\/\//.test(String(url ?? ''))) {
      throw new Error('INVALID_URL')
    }
    try {
      if (!this.#browser || !this.#page || this.#page.isClosed()) {
        await this.#launch()
      }
      await this.#page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      this.#title = await this.#page.title().catch(() => null)
      this.#status = 'ready'
      this.#error = null
      return this.getStatus()
    } catch (error) {
      this.#status = 'error'
      this.#error = error?.message ?? String(error)
      return this.getStatus()
    }
  }

  async #launch() {
    if (!isRemoteBrowserConfigured() && !this.#executablePath) {
      throw new Error('未找到可用的浏览器，请检查 PUPPETEER_EXECUTABLE_PATH')
    }
    const { initPuppeteer } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
    const { puppeteer } = await initPuppeteer()
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
    const bossCookies = (await readStorageFile('boss-cookies.json')) ?? []
    for (const cookie of bossCookies) {
      if (Object.hasOwn(cookie, 'sameSite')) {
        cookie.sameSite = 'unspecified'
      }
      await page.setCookie(cookie).catch(() => undefined)
    }
    try {
      const bossLocalStorage = (await readStorageFile('boss-local-storage.json')) ?? {}
      if (Object.keys(bossLocalStorage).length) {
        await setDomainLocalStorage(browser, LOCAL_STORAGE_PAGE_URL, bossLocalStorage)
      }
    } catch {
      // localStorage is best-effort
    }
    page.once('close', () => {
      this.#page = null
      this.#status = 'closed'
    })
    this.#status = 'ready'
  }

  async screenshot() {
    const run = async () => {
      const page = this.#page
      if (!page || page.isClosed()) {
        throw new Error('NO_ACTIVE_SITE_SESSION')
      }
      return page.screenshot({ type: 'jpeg', quality: 70, fullPage: false })
    }
    this.#captureChain = this.#captureChain.then(run, run)
    return this.#captureChain
  }

  async click(xRatio, yRatio) {
    const page = this.#page
    if (!page || page.isClosed()) {
      throw new Error('NO_ACTIVE_SITE_SESSION')
    }
    const x = Math.max(0, Math.min(1, Number(xRatio) || 0)) * VIEWPORT.width
    const y = Math.max(0, Math.min(1, Number(yRatio) || 0)) * VIEWPORT.height
    await page.mouse.click(x, y)
    this.#status = 'ready'
  }

  async type(text) {
    const page = this.#page
    if (!page || page.isClosed()) {
      throw new Error('NO_ACTIVE_SITE_SESSION')
    }
    await page.keyboard.type(String(text ?? ''), { delay: 30 })
  }

  async key(keyName) {
    const page = this.#page
    if (!page || page.isClosed()) {
      throw new Error('NO_ACTIVE_SITE_SESSION')
    }
    await page.keyboard.press(String(keyName ?? 'Enter'))
  }

  async saveCookies() {
    const page = this.#page
    if (!page || page.isClosed()) {
      throw new Error('NO_ACTIVE_SITE_SESSION')
    }
    const [cookies, localStorage] = await Promise.all([
      page.cookies(),
      page
        .evaluate(() => JSON.stringify(window.localStorage))
        .then((value) => JSON.parse(value))
        .catch(() => ({}))
    ])
    if (!Array.isArray(cookies) || !cookies.length) {
      throw new Error('当前页面没有可保存的 Cookie')
    }
    await Promise.all([
      writeStorageFile('boss-cookies.json', cookies),
      writeStorageFile('boss-local-storage.json', localStorage)
    ])
    return cookies
  }

  async close() {
    const browser = this.#browser
    const page = this.#page
    this.#browser = null
    this.#page = null
    this.#status = 'idle'
    this.#title = null
    await disposeBrowser(browser, page).catch(() => undefined)
  }
}