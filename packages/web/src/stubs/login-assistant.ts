import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { readStorageFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { checkCookieListFormat } from '../../../ui/src/common/utils/cookie'
import { sendToDaemon } from './daemon'

const MAX_LOGIN_WAIT_MS = 15 * 60 * 1000

/**
 * Desktop pops up an Electron browser window. The web server shows a headless
 * QR login page instead and writes the cookie file once the scan succeeds.
 * The worker only needs to wait for that file.
 */
export async function loginWithCookieAssistant() {
  sendToDaemon({
    type: 'worker-to-gui-message',
    workerId: process.env.GEEKGEEKRUND_WORKER_ID,
    data: {
      type: 'web-login-required'
    }
  })

  const deadline = Date.now() + MAX_LOGIN_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(2000)
    try {
      if (checkCookieListFormat(readStorageFile('boss-cookies.json'))) {
        return true
      }
    } catch {
      // keep waiting
    }
  }
  throw new Error('USER_CANCELLED_LOGIN')
}