import fs from 'node:fs'
import path from 'node:path'
import { rendererRoot, webDistRoot } from './browser.mjs'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
}

function resolveFile(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0].split('#')[0])
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const candidate = path.join(root, normalized)
  if (!candidate.startsWith(root)) {
    return null
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate
  }
  return null
}

const ENTRY_NAMES = ['/index.html', '/web.html']

export function resolveStaticFile(urlPath) {
  if (urlPath === '/') {
    for (const name of ENTRY_NAMES) {
      const entry = resolveFile(rendererRoot, name)
      if (entry) {
        return entry
      }
    }
  }
  return resolveFile(rendererRoot, urlPath) ?? resolveFile(webDistRoot, urlPath)
}

export function sendStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  })
  fs.createReadStream(filePath).pipe(res)
}

export function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

export function readJsonBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`INVALID_JSON_BODY: ${error.message}`))
      }
    })
    req.on('error', reject)
  })
}