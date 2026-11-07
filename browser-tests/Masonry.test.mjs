import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'

const browsers = { chromium, firefox, webkit }
const names = (process.env.MASONRY_BROWSERS ?? 'chromium,firefox,webkit').split(',')
const root = fileURLToPath(new URL('../', import.meta.url))
let server
let url

before(async () => {
  server = spawn(process.execPath, ['scripts/dev-server.mjs', '/browser-tests/fixture.html'], {
    cwd: root,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Browser fixture server did not start: ${output}`)), 10_000)
    server.on('error', reject)
    server.stderr.on('data', data => { output += data })
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture server exited ${code}: ${output}`)) })
    server.stdout.on('data', data => {
      output += data
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/browser-tests\/fixture\.html/)
      if (match) { clearTimeout(timeout); resolve(match[0]) }
    })
  })
})

after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
})

for (const name of names) {
  if (!browsers[name]) throw new Error(`Unknown browser: ${name}`)
  describe(name, () => {
    let browser

    before(async () => {
      const options = { headless: true }
      if (name === 'chromium' && process.env.MASONRY_CHROMIUM_EXECUTABLE) {
        options.executablePath = process.env.MASONRY_CHROMIUM_EXECUTABLE
        options.args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      }
      if (name === 'firefox' && process.env.MASONRY_FIREFOX_DISABLE_SANDBOX === '1') {
        options.env = { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' }
      }
      if (name === 'webkit' && process.env.MASONRY_WEBKIT_EXECUTABLE) {
        options.executablePath = process.env.MASONRY_WEBKIT_EXECUTABLE
        const bin = dirname(options.executablePath)
        options.env = {
          ...process.env,
          WEBKIT_EXEC_PATH: bin,
          WEBKIT_INJECTED_BUNDLE_PATH: resolve(bin, '../lib'),
          WEBKIT_INSPECTOR_RESOURCES_PATH: resolve(bin, '../share'),
          LD_LIBRARY_PATH: process.env.MASONRY_WEBKIT_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? '',
        }
      }
      browser = await browsers[name].launch(options)
      console.log(`Browser under test: ${name} ${browser.version()}`)
    })
    after(async () => { await browser?.close() })

    async function check(run) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.goto(url)
        await page.waitForFunction(() => typeof globalThis.Masonry === 'function')
        await run(page)
        assert.deepEqual(errors, [], 'Browser must not raise uncaught errors')
        assert.deepEqual(await page.evaluate(() => globalThis.policyViolations), [])
      } finally {
        await page.close()
      }
    }

    test('all layout modes keep mixed-height cards inside the grid without overlap', async () => {
      await check(async page => {
        const failures = await page.evaluate(async () => {
          const failures = []
          for (const layoutMode of ['masonry', 'row', 'column']) {
            for (const width of [320, 620, 1010]) {
              const container = document.createElement('section')
              container.style.width = `${width}px`
              document.body.appendChild(container)
              const grid = new Masonry(container, { columnWidth: 200, gap: 10, layoutMode })
              await grid.append(Array.from({ length: 30 }, (_, index) => {
                const element = document.createElement('article')
                element.style.height = `${30 + (index * 47) % 140}px`
                return { id: String(index), element, colSpan: index % 5 === 0 ? 2 : 1 }
              }))
              const bounds = container.getBoundingClientRect()
              const boxes = [...container.children].map(element => element.getBoundingClientRect())
              for (let i = 0; i < boxes.length; i += 1) {
                const box = boxes[i]
                if (box.left < bounds.left - 0.1 || box.right > bounds.right + 0.1 || box.bottom > bounds.bottom + 0.1) {
                  failures.push(`${layoutMode}/${width}: outside bounds at ${i}`)
                }
                for (let j = i + 1; j < boxes.length; j += 1) {
                  const other = boxes[j]
                  if (Math.min(box.right, other.right) - Math.max(box.left, other.left) > 0.1
                    && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 0.1) {
                    failures.push(`${layoutMode}/${width}: overlap ${i}/${j}`)
                  }
                }
              }
              grid.destroy()
              container.remove()
            }
          }
          return failures
        })
        assert.deepEqual(failures, [])
      })
    })

    test('container resize remeasures wrapped text and recalculates columns', async () => {
      await check(async page => {
        await page.evaluate(async () => {
          const container = document.createElement('section')
          container.id = 'grid'
          container.style.width = '620px'
          document.body.appendChild(container)
          globalThis.grid = new Masonry(container, { columnWidth: 200, gap: 10, autoColSpan: false })
          await grid.append(Array.from({ length: 12 }, (_, index) => {
            const element = document.createElement('article')
            element.textContent = 'Measured text content which wraps onto multiple lines. '.repeat(index % 3 + 1)
            return { id: String(index), element }
          }))
          container.style.width = '310px'
        })
        await page.waitForFunction(() => grid.getColumnCount() === 1)
        await page.waitForFunction(() => {
          const items = [...document.querySelector('#grid').children]
          return items.every((element, index) => index === 0
            || element.getBoundingClientRect().top >= items[index - 1].getBoundingClientRect().bottom + 9.9)
        })
        await page.evaluate(() => grid.destroy())
      })
    })

    test('media completing after the timeout causes an automatic relayout', async () => {
      await check(async page => {
        let release
        const imageReady = new Promise(resolve => { release = resolve })
        await page.route('**/delayed-image.svg', async route => {
          await imageReady
          await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="navy"/></svg>' })
        })
        await page.evaluate(async () => {
          const container = document.createElement('section')
          container.style.width = '200px'
          document.body.appendChild(container)
          globalThis.grid = new Masonry(container, { columnWidth: 200, gap: 10, contentLoadTimeout: 20 })
          const image = document.createElement('img')
          image.style.display = 'block'
          image.style.width = '100%'
          image.src = '/delayed-image.svg'
          const following = document.createElement('article')
          following.id = 'following'
          following.style.height = '30px'
          await grid.append([{ id: 'image', element: image, colSpan: 1 }, { id: 'following', element: following, colSpan: 1 }])
        })
        release()
        await page.waitForFunction(() => {
          const first = grid.getItems()[0].element.parentElement.getBoundingClientRect()
          const second = document.querySelector('#following').parentElement.getBoundingClientRect()
          return first.height >= 150 && second.top >= first.bottom + 9.9
        })
        await page.evaluate(() => grid.destroy())
      })
    })

    test('late intrinsic image width updates auto spans even with a fixed displayed height', async () => {
      await check(async page => {
        let release
        const imageReady = new Promise(resolve => { release = resolve })
        await page.route('**/wide-image.svg', async route => {
          await imageReady
          await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="navy"/></svg>' })
        })
        await page.evaluate(async () => {
          const container = document.createElement('section')
          container.style.width = '600px'
          document.body.appendChild(container)
          globalThis.grid = new Masonry(container, { columnWidth: 200, gap: 0, contentLoadTimeout: 0 })
          const image = document.createElement('img')
          image.style.cssText = 'display:block;width:100%;height:100px'
          image.src = '/wide-image.svg'
          await grid.append([{ id: 'image', element: image, height: 100 }])
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        })
        assert.equal(await page.evaluate(() => grid.getItems()[0].colSpan), 1)
        release()
        await page.waitForFunction(() => grid.getItems()[0].colSpan === 3)
        assert.equal(await page.evaluate(() => grid.getItems()[0].element.parentElement.style.width), '600px')
        await page.evaluate(() => grid.destroy())
      })
    })

    test('CSS transforms do not change the number or CSS width of columns', async () => {
      await check(async page => {
        const result = await page.evaluate(async () => {
          const container = document.createElement('section')
          container.style.cssText = 'width:620px;transform:scale(.5);transform-origin:top left'
          document.body.appendChild(container)
          const grid = new Masonry(container, { columnWidth: 200, gap: 10 })
          await grid.append(Array.from({ length: 3 }, (_, index) => {
            const element = document.createElement('article')
            element.style.height = '30px'
            return { id: String(index), element, height: 30, colSpan: 1 }
          }))
          const result = { columns: grid.getColumnCount(), width: container.firstElementChild.style.width }
          grid.destroy()
          return result
        })
        assert.deepEqual(result, { columns: 3, width: '200px' })
      })
    })

    test('padding and borders are excluded from the usable grid width', async () => {
      await check(async page => {
        const result = await page.evaluate(async () => {
          const container = document.createElement('section')
          container.style.cssText = 'width:620px;box-sizing:border-box;padding:20px;border:5px solid black'
          document.body.appendChild(container)
          const grid = new Masonry(container, { columnWidth: 200, gap: 10 })
          await grid.append(Array.from({ length: 2 }, (_, index) => {
            const element = document.createElement('article')
            element.style.height = '30px'
            return { id: String(index), element, height: 30, colSpan: 1 }
          }))
          const bounds = container.getBoundingClientRect()
          const first = container.firstElementChild.getBoundingClientRect()
          const last = container.lastElementChild.getBoundingClientRect()
          const result = {
            columns: grid.getColumnCount(), left: first.left - bounds.left,
            top: first.top - bounds.top, right: bounds.right - last.right,
            height: bounds.height,
          }
          grid.destroy()
          return result
        })
        assert.deepEqual(result, { columns: 2, left: 25, top: 25, right: 25, height: 80 })
      })
    })

    test('scrollbar gutters are excluded from the usable width and left offset', async () => {
      await check(async page => {
        const results = await page.evaluate(async () => {
          const results = []
          for (const gutter of ['stable', 'stable both-edges']) {
            const container = document.createElement('section')
            container.style.cssText = `width:300px;box-sizing:border-box;padding:10px;border:2px solid black;overflow-y:scroll;scrollbar-gutter:${gutter}`
            document.body.appendChild(container)
            const availableWidth = container.clientWidth - 20
            const expectedLeft = container.clientLeft + 10
            const grid = new Masonry(container, { columnWidth: 130, gap: 0 })
            await grid.append(Array.from({ length: 3 }, (_, index) => {
              const element = document.createElement('article')
              return { id: String(index), element, height: 30, colSpan: 1 }
            }))
            const containerBox = container.getBoundingClientRect()
            const firstBox = container.firstElementChild.getBoundingClientRect()
            results.push({
              columns: grid.getColumnCount(), expectedColumns: Math.max(1, Math.floor(availableWidth / 130)),
              left: firstBox.left - containerBox.left, expectedLeft,
              width: firstBox.width, expectedWidth: availableWidth / Math.max(1, Math.floor(availableWidth / 130)),
            })
            grid.destroy()
            container.remove()
          }
          return results
        })
        for (const result of results) {
          assert.equal(result.columns, result.expectedColumns, JSON.stringify(result))
          assert.equal(result.left, result.expectedLeft, JSON.stringify(result))
          assert.ok(Math.abs(result.width - result.expectedWidth) < 0.05, JSON.stringify(result))
        }
      })
    })

    test('infinite loading continues while successful short pages leave the sentinel visible', async () => {
      await check(async page => {
        await page.evaluate(() => {
          const container = document.createElement('section')
          container.style.width = '200px'
          document.body.appendChild(container)
          globalThis.loads = 0
          globalThis.grid = new Masonry(container, {
            columnWidth: 200,
            async loadMore() {
              loads += 1
              const element = document.createElement('article')
              element.style.height = '30px'
              await grid.append([{ id: String(loads), element, height: 30, colSpan: 1 }])
              return loads < 3
            },
          })
        })
        await page.waitForFunction(() => loads === 3, null, { timeout: 2000 })
        assert.equal(await page.evaluate(() => grid.getItems().length), 3)
        await page.evaluate(() => grid.destroy())
      })
    })

    test('repeated teardown restores elements and leaves no wrappers or sentinels', async () => {
      await check(async page => {
        const result = await page.evaluate(async () => {
          const container = document.createElement('section')
          container.style.cssText = 'width:620px;height:24px!important;position:absolute!important'
          document.body.appendChild(container)
          const observers = new Set()
          for (const name of ['ResizeObserver', 'IntersectionObserver']) {
            const NativeObserver = globalThis[name]
            globalThis[name] = class extends NativeObserver {
              constructor(callback) { super(callback); observers.add(this) }
              disconnect() { super.disconnect(); observers.delete(this) }
            }
          }
          const frames = new Set()
          const request = requestAnimationFrame
          const cancel = cancelAnimationFrame
          globalThis.requestAnimationFrame = callback => {
            const id = request(time => { frames.delete(id); callback(time) })
            frames.add(id)
            return id
          }
          globalThis.cancelAnimationFrame = id => { frames.delete(id); cancel(id) }
          for (let cycle = 0; cycle < 30; cycle += 1) {
            container.replaceChildren()
            const grid = new Masonry(container, { columnWidth: 200, loadMore: () => false })
            const element = document.createElement('article')
            element.textContent = '<img src=x onerror=alert(1)>'
            await grid.append([{ id: '<script>danger</script>', element, height: 20, colSpan: 1 }])
            grid.destroy()
            grid.destroy()
            if (container.children.length !== 1 || element.parentNode !== container) return { brokenCycle: cycle }
          }
          return {
            wrappers: document.querySelectorAll('.masonry-item,.masonry-sentinel').length,
            height: container.style.height, priority: container.style.getPropertyPriority('height'),
            position: container.style.position,
            observers: observers.size, frames: frames.size,
          }
        })
        assert.deepEqual(result, { wrappers: 0, height: '24px', priority: 'important', position: 'absolute', observers: 0, frames: 0 })
      })
    })
  })
}
