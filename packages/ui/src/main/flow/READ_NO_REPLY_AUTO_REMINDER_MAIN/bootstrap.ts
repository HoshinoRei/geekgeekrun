import { Browser } from 'puppeteer'
import { initPuppeteer } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import { pageMapByName } from './index'

import { readStorageFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import { getPuppeteerLaunchArgs } from '@geekgeekrun/utils/puppeteer/launch-options.mjs'
import {
  connectOrLaunchBrowser,
  isRemoteBrowser
} from '@geekgeekrun/utils/puppeteer/browser-connection.mjs'

const localStoragePageUrl = `https://www.zhipin.com/desktop/`
const bossChatUiUrl = `https://www.zhipin.com/web/geek/chat`

export async function bootstrap() {
  const { puppeteer } = await initPuppeteer()

  const browser = await connectOrLaunchBrowser(puppeteer, {
    headless: process.env.GEEKGEEKRUN_HEADLESS === '1',
    args: getPuppeteerLaunchArgs(),
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: 1440,
      height: 800
    },
    devtools: process.env.NODE_ENV === 'development'
  })

  return browser
}

export async function launchBoss(browser: Browser) {
  const page = isRemoteBrowser(browser) ? await browser.newPage() : (await browser.pages())[0]
  pageMapByName['boss'] = page
  const bossCookies = readStorageFile('boss-cookies.json')
  const bossLocalStorage = readStorageFile('boss-local-storage.json')
  //set cookies
  for (let i = 0; i < bossCookies.length; i++) {
    if (Object.hasOwn(bossCookies[i], 'sameSite')) {
      bossCookies[i].sameSite = 'unspecified'
    }
    await page.setCookie(bossCookies[i])
  }
  await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage)
  try {
    await Promise.all([
      page.goto(bossChatUiUrl, { timeout: 0 }),
      page.waitForNavigation({ timeout: 120 * 1000 })
    ])
  } catch (error) {
    if (error?.message?.startsWith('net::ERR_INTERNET_DISCONNECTED')) {
      throw new Error('ERR_INTERNET_DISCONNECTED')
    }
    throw error
  }
  page.once('close', () => {
    pageMapByName['boss'] = null
    if (!isRemoteBrowser(browser)) {
      const cp = browser.process()
      cp?.kill()
    }
  })
  return page
}
