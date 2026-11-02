import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pyStringLiteral, rpycAst, saveDirFromRpyc, saveDirFromSource, nameVersionFromSource } from '../pipeline/detect.js'
import { parseRpaHeader } from '../pipeline/rpa.js'
import { PyGlobal, PyObject, unpickle } from '../util/pickle.js'

// Generated with CPython's pickle (see the fixture generator in the repo history).
const fx = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures.json'), 'utf-8')) as Record<string, string>
const b64 = (k: string) => Buffer.from(fx[k]!, 'base64')

describe('unpickle', () => {
  for (const proto of ['p2', 'p5']) {
    it(`reads an RPA index pickled with protocol ${proto}`, () => {
      const idx = unpickle(b64(`rpa_index_${proto}`)) as Map<string, unknown[]>
      expect(idx).toBeInstanceOf(Map)
      const bg = idx.get('images/bg one.png') as unknown[][]
      // Values are stored XORed with the archive key; parseRpaIndex undoes that.
      expect(bg[0]![0]).toBe(Number(BigInt(1234567890123) ^ BigInt(0xdeadbeef)))
      const audio = idx.get('audio/x.ogg') as unknown[][]
      expect(Buffer.from(audio[0]![2] as Uint8Array).toString('latin1')).toBe('OggS')
    })
  }

  it('never executes reduce calls', () => {
    const v = unpickle(b64('evil'))
    expect(v).toBeInstanceOf(PyObject)
    expect((v as PyObject).cls).toMatch(/system$/)
  })

  it('rejects truncated input', () => {
    const buf = b64('rpa_index_p2')
    expect(() => unpickle(buf.subarray(0, 20))).toThrow()
  })

  it('represents globals without resolving them', () => {
    // GLOBAL 'os\nsystem\n' then STOP
    const v = unpickle(Buffer.from('cos\nsystem\n.', 'latin1'))
    expect(v).toBeInstanceOf(PyGlobal)
  })
})

describe('save directory detection', () => {
  it('finds define config.save_directory in a compiled script', () => {
    expect(saveDirFromRpyc(b64('rpyc_define'))).toBe('MyGame-1234567890')
  })

  it('finds config.save_directory assigned in a python block', () => {
    expect(saveDirFromRpyc(b64('rpyc_python'))).toBe('Other-42')
  })

  it('reads the AST slot of an rpyc', () => {
    expect(rpycAst(b64('rpyc_define'))?.length).toBeGreaterThan(100)
  })

  it('parses script sources', () => {
    const src = `
define config.name = _("Pale Carnations")
define config.version = "Ch4Up7Public"
    # comment
define config.save_directory = "PaCaGame-1554919452"
`
    expect(saveDirFromSource(src)).toBe('PaCaGame-1554919452')
    expect(nameVersionFromSource(src)).toEqual({ name: 'Pale Carnations', version: 'Ch4Up7Public' })
    expect(saveDirFromSource('define config.save_directory = None')).toBeNull()
  })

  it('parses python string literals', () => {
    expect(pyStringLiteral(`'a\\'b'`)).toBe("a'b")
    expect(pyStringLiteral(`r"C:\\x"`)).toBe('C:\\x')
    expect(pyStringLiteral('None')).toBeNull()
  })
})

describe('rpa header', () => {
  it('parses RPA-3.0 and RPA-2.0 headers', () => {
    expect(parseRpaHeader(Buffer.from('RPA-3.0 00000000001f0f2a 42424242\n'))).toMatchObject({ version: 'RPA-3.0', indexOffset: 0x1f0f2a, key: 0x42424242 })
    expect(parseRpaHeader(Buffer.from('RPA-2.0 0000000000000100\n'))).toMatchObject({ version: 'RPA-2.0', indexOffset: 256, key: 0 })
    expect(parseRpaHeader(Buffer.from('ZiX-12B 123\n'))).toBeNull()
  })
})

