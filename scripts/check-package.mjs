import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this check with npm run test:package')
const directory = await mkdtemp(join(tmpdir(), 'masonry-package-'))

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Package check failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

try {
  run(process.execPath, [npm, 'run', 'build'])
  const [pack] = JSON.parse(run(process.execPath, [
    npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory,
  ]))
  const names = pack.files.map(file => file.path)
  for (const required of ['dist/src/index.js', 'dist/src/index.d.ts', 'dist/styles/masonry.css', 'LICENSE']) {
    assert.ok(names.includes(required), `${required} is missing from the package`)
  }
  assert.ok(names.every(name => name.startsWith('dist/')
    || ['package.json', 'README.md', 'README.ru.md', 'LICENSE'].includes(name)))

  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  // Existing consumers can still have the older dependency pinned. The tarball
  // must request a version that implements the documented loadMore(false) contract.
  run(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '@shelamkoff/infinite-scroll@1.0.0', 'jsdom@26.1.0'], directory)
  run(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, pack.filename)], directory)
  const consumer = `
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Masonry } from '@shelamkoff/masonry'
assert.equal(typeof Masonry, 'function')
assert.throws(() => new Masonry(null, { columnWidth: 200 }), /browser document/)
const css = readFileSync(new URL(import.meta.resolve('@shelamkoff/masonry/styles.css')), 'utf8')
assert.ok(css.includes('.masonry-container'))
const manifest = JSON.parse(readFileSync(new URL(import.meta.resolve('@shelamkoff/masonry/package.json')), 'utf8'))
assert.equal(manifest.name, '@shelamkoff/masonry')
console.log('Installed ESM and CSS exports passed; import is safe without a browser document')
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><section></section>')
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: clearTimeout,
})
let observer
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; observer = this }
  observe() {}
  unobserve() {}
  disconnect() {}
}
let calls = 0
const container = document.querySelector('section')
container.getBoundingClientRect = () => ({ width: 200 })
const grid = new Masonry(container, { columnWidth: 200, loadMore() { calls += 1; return false } })
try {
  observer.callback([{ isIntersecting: true }])
  await new Promise(resolve => setImmediate(resolve))
  observer.callback([{ isIntersecting: true }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1, 'Installed dependency must honor loadMore returning false')
  const element = document.createElement('article')
  await grid.append([{ id: 'installed', element, height: 20, colSpan: 1 }])
  assert.equal(grid.getItems().length, 1)
  grid.destroy()
  assert.equal(element.parentNode, container)
  console.log('Installed append/destroy and dependency-version compatibility passed')
} finally {
  grid.destroy()
  dom.window.close()
}
`
  await writeFile(join(directory, 'consumer.mjs'), consumer)
  console.log(run(process.execPath, ['consumer.mjs'], directory).trim())
  await cp(join(root, 'type-tests/consumer.ts'), join(directory, 'consumer.ts'))
  await cp(join(root, 'type-tests/tsconfig.json'), join(directory, 'tsconfig.json'))
  console.log(run(process.execPath, [join(root, 'scripts/check-types.mjs'), join(directory, 'tsconfig.json')]).trim())
  const installed = JSON.parse(await readFile(join(directory, 'node_modules/@shelamkoff/masonry/package.json'), 'utf8'))
  assert.equal(installed.version, pack.version)
  console.log(`Package verified: ${pack.filename}; ${names.length} files; ${pack.size} bytes packed; ${pack.unpackedSize} bytes unpacked`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
