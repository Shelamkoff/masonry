import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { domainToASCII, fileURLToPath } from 'node:url'

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)))
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
  try {
    const url = new URL(requestUrl ?? '/', 'http://localhost')
    const pathname = url.pathname === '/' ? entryPath : decodeURIComponent(url.pathname)
    let candidate = resolve(root, `.${pathname}`)
    if (!isPublicPath(candidate)) return null

    candidate = await realpath(candidate)
    if (!isPublicPath(candidate)) return null
    if ((await stat(candidate)).isDirectory()) {
      candidate = await realpath(join(candidate, 'index.html'))
    }
    if (!isPublicPath(candidate) || !(await stat(candidate)).isFile()) return null
    return candidate
  } catch {
    return null
  }
}

function isPublicPath(filePath) {
  const fromRoot = relative(root, filePath)
  return !isAbsolute(fromRoot) && !fromRoot.split(sep).some(part => part.startsWith('.'))
}

function isAllowedHost(authority) {
  if (typeof authority !== 'string' || /[\s\\/@?#]/.test(authority)) return false
  try {
    const hostname = new URL(`http://${authority}`).hostname.toLowerCase().replace(/\.$/, '')
    const address = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    return isIP(address) !== 0
      || hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === domainToASCII(host).toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
}

const server = createServer(async (request, response) => {
  // A loopback listener still needs Host validation to prevent DNS rebinding.
  if (!isAllowedHost(request.headers.host)) {
    send(response, 403, 'Host not allowed')
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method not allowed')
    return
  }
  const filePath = await resolveRequestPath(request.url)
  if (!filePath) {
    send(response, 404, 'Not found')
    return
  }
  const headers = {
    'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (request.method === 'HEAD') {
    response.writeHead(200, headers)
    response.end()
    return
  }
  const stream = createReadStream(filePath)
  stream.on('error', () => {
    if (response.destroyed) return
    if (response.headersSent) response.destroy()
    else send(response, 404, 'Not found')
  })
  response.on('close', () => stream.destroy())
  stream.on('open', () => {
    if (response.destroyed) {
      stream.destroy()
      return
    }
    response.writeHead(200, headers)
    stream.pipe(response)
  })
})

server.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
server.listen(port, host, () => {
  console.log(`Masonry demo: http://${host}:${server.address().port}${entryPath}`)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit()))
}
