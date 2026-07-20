import { cp, mkdir, rm } from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(new URL('../src/', import.meta.url), new URL('src/', dist), { recursive: true })
await cp(new URL('../styles/', import.meta.url), new URL('styles/', dist), { recursive: true })
