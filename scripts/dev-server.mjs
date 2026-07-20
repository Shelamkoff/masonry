import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '4173', 10)
const requestedEntry = process.argv[2] ?? '/demo.html'
const entryPath = requestedEntry.startsWith('/') ? requestedEntry : `/${requestedEntry}`

if (!entryPath.endsWith('.html')) throw new TypeError('Demo entry must point to an HTML file')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
])

function send(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(message)
}

async function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl ?? '/', `http://${host}:${port}`)
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname === '/') pathname = entryPath
  const candidate = resolve(root, `.${pathname}`)
  const fromRoot = relative(root, candidate)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null
  try {
    const info = await stat(candidate)
    return info.isDirectory() ? join(candidate, 'index.html') : candidate
  } catch {
    return null
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method not allowed')
    return
  }
  const filePath = await resolveRequestPath(request.url)
  if (!filePath) {
    send(response, 404, 'Not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  createReadStream(filePath).pipe(response)
})

server.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
server.listen(port, host, () => {
  console.log(`Masonry demo: http://${host}:${port}${entryPath}`)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit()))
}
