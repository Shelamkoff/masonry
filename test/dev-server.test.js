import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

async function startServer(t) {
  const directory = await mkdtemp(join(tmpdir(), 'masonry-server-'))
  const root = join(directory, 'public')
  await mkdir(join(root, 'scripts'), { recursive: true })
  await copyFile(new URL('../scripts/dev-server.mjs', import.meta.url), join(root, 'scripts/dev-server.mjs'))
  await writeFile(join(root, 'demo.html'), '<!doctype html><title>Masonry test</title>')

  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const { port } = reservation.address()
  await new Promise(resolve => reservation.close(resolve))

  const child = spawn(process.execPath, [join(root, 'scripts/dev-server.mjs')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  let output = ''
  child.stderr.on('data', data => { output += data })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
    await rm(directory, { recursive: true, force: true })
  })

  await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => { throw new Error(`Demo server exited before listening: ${output}`) }),
  ])

  return {
    directory,
    root,
    get(path, method = 'GET') {
      return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, method, agent: false }, response => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', chunk => { body += chunk })
          response.on('error', reject)
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
        })
        req.on('error', reject)
        req.setTimeout(2_000, () => req.destroy(new Error(`Demo request timed out: ${path}`)))
        req.end()
      })
    },
  }
}

test('demo server serves files with GET and HEAD and rejects writes', async t => {
  const server = await startServer(t)
  const get = await server.get('/')
  assert.equal(get.status, 200)
  assert.match(get.body, /Masonry test/)
  assert.equal(get.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(get.headers['x-content-type-options'], 'nosniff')

  const head = await server.get('/demo.html', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, '')
  assert.equal((await server.get('/demo.html', 'POST')).status, 405)
})

test('a directory without an index returns 404 without crashing the demo server', async t => {
  const server = await startServer(t)
  await mkdir(join(server.root, 'empty'))

  assert.equal((await server.get('/empty/')).status, 404)
  assert.equal((await server.get('/empty/', 'HEAD')).status, 404)
  assert.equal((await server.get('/demo.html')).status, 200)
})

test('a malformed request URL does not terminate the demo server', async t => {
  const server = await startServer(t)

  assert.equal((await server.get('http://[')).status, 404)
  assert.equal((await server.get('/demo.html')).status, 200)
})

test('the demo server does not expose hidden project files', async t => {
  const server = await startServer(t)
  await writeFile(join(server.root, '.env'), 'EXAMPLE_SECRET=not-public')
  await mkdir(join(server.root, '.git'))
  await writeFile(join(server.root, '.git', 'config'), 'example private configuration')

  assert.equal((await server.get('/.env')).status, 404)
  assert.equal((await server.get('/%2egit/config')).status, 404)
})

test('the demo server confines symlinks and directory indexes to public files', async t => {
  const server = await startServer(t)
  const externalFile = join(server.directory, 'outside.txt')
  await writeFile(externalFile, 'example file outside the document root')
  await symlink(externalFile, join(server.root, 'linked.txt'))
  await mkdir(join(server.root, 'linked-index'))
  await symlink(externalFile, join(server.root, 'linked-index', 'index.html'))

  assert.equal((await server.get('/linked.txt')).status, 404)
  assert.equal((await server.get('/linked-index/')).status, 404)
})

test('the demo server rejects encoded traversal and malformed percent encoding', async t => {
  const server = await startServer(t)
  await writeFile(join(server.directory, 'outside.txt'), 'example file outside the document root')

  assert.equal((await server.get('/..%2foutside.txt')).status, 404)
  assert.equal((await server.get('/%E0%A4%A')).status, 404)
  assert.equal((await server.get('/demo.html')).status, 200)
})
