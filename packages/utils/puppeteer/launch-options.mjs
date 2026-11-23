/**
 * Extra Chromium args for container deployments. Empty on desktop unless
 * GEEKGEEKRUN_PUPPETEER_ARGS is set.
 */
export function getPuppeteerLaunchArgs () {
  return (process.env.GEEKGEEKRUN_PUPPETEER_ARGS ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
