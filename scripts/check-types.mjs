import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const manifestPath = require.resolve('typescript/package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const compiler = resolve(dirname(manifestPath), manifest.bin.tsc)
const config = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../type-tests/tsconfig.json', import.meta.url))

for (const [module, moduleResolution] of [
  ['Node16', 'Node16'],
  ['NodeNext', 'NodeNext'],
  ['ESNext', 'Bundler'],
]) {
  const result = spawnSync(process.execPath, [
    compiler,
    '--project', config,
    '--module', module,
    '--moduleResolution', moduleResolution,
  ], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`TypeScript consumer: ${moduleResolution} passed`)
}
