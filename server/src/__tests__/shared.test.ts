import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The library builds from server/src/shared too, without the server's code or packages.
describe('shared', () => {
  it('imports nothing but its own files', () => {
    const dir = join(import.meta.dirname, '..', 'shared')
    const outside = readdirSync(dir).filter((f) => f.endsWith('.ts')).flatMap((f) =>
      [...readFileSync(join(dir, f), 'utf-8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!).filter((spec) => !/^\.\/[\w-]+\.js$/.test(spec)).map((spec) => `${f}: ${spec}`),
    )
    expect(outside).toEqual([])
  })
})
