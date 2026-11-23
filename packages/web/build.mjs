import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const stubs = path.join(packageRoot, 'src/stubs')
const outdir = path.join(packageRoot, 'web-dist')

const stubPlugin = {
  name: 'web-stubs',
  setup(build) {
    const rules = [
      [/^electron$/, 'electron.ts'],
      [/\/gtag\/GtagPlugin$/, 'gtag-plugin.ts'],
      [/\/gtag$/, 'gtag.ts'],
      [/\/initPublicIpc$/, 'init-public-ipc.ts'],
      [/\/worker$/, 'worker.ts'],
      [/\/browser-history$/, 'browser-history.ts'],
      [/\/config-with-browser-assistant$/, 'browser-assistant.ts'],
      [/\/login-with-cookie-assistant$/, 'login-assistant.ts'],
      [/\/connect-to-daemon$/, 'daemon.ts']
    ]
    for (const [filter, file] of rules) {
      build.onResolve({ filter }, () => ({ path: path.join(stubs, file) }))
    }
  }
}

const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  outExtension: { '.js': '.cjs' },
  logLevel: 'info'
}

// Workspace and third-party packages stay external. Node's ESM/CJS interop plus
// the sqlite plugin's exports map resolves its extensionless deep imports.
const externalOptions = {
  ...commonOptions,
  packages: 'external'
}

const esmExternalOptions = {
  ...externalOptions,
  format: 'esm',
  outExtension: { '.js': '.mjs' }
}

const jobs = [
  {
    ...externalOptions,
    entryPoints: [path.join(packageRoot, 'src/db-worker.ts')],
    outfile: path.join(outdir, 'db-worker.cjs')
  },
  {
    ...externalOptions,
    entryPoints: [path.join(packageRoot, 'src/llm-bridge.ts')],
    outfile: path.join(outdir, 'llm-bridge.cjs')
  },
  {
    ...esmExternalOptions,
    entryPoints: [path.join(packageRoot, 'src/auto-chat-worker.ts')],
    outfile: path.join(outdir, 'auto-chat-worker.mjs'),
    plugins: [stubPlugin]
  },
  {
    ...esmExternalOptions,
    entryPoints: [path.join(packageRoot, 'src/read-no-reply-worker.ts')],
    outfile: path.join(outdir, 'read-no-reply-worker.mjs'),
    plugins: [stubPlugin]
  }
]

fs.rmSync(outdir, { recursive: true, force: true })
for (const job of jobs) {
  await build({ ...commonOptions, ...job })
}
console.log('web server bundles built at', outdir)