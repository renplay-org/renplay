import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nameVersionFromSource, pyStringLiteral, pythonOf, renpyVersionFromVc, rpycAst, saveDirFromRpyc, saveDirFromSource } from '../pipeline/detect.js'
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

describe('Ren\'Py version', () => {
  it('reads Ren\'Py 8 and Ren\'Py 7 version files', () => {
    expect(renpyVersionFromVc("branch = 'fix'\nversion = '8.3.4.24120703'\n")).toBe('8.3.4.24120703')
    // Ren'Py 7.5 to 7.8 write it as a Python 2 unicode literal.
    expect(renpyVersionFromVc("branch = u'fix'\nversion = u'7.8.7.25031702'\n")).toBe('7.8.7.25031702')
    const init = 'vc_version = 0\nversion_tuple = (7, 3, 2, vc_version)\n'
    expect(renpyVersionFromVc('vc_version = 320', init)).toBe('7.3.2.320')
    expect(renpyVersionFromVc('vc_version = 320')).toBeUndefined()
    const both = 'if PY2:\n    version_tuple = (7, 5, 3, vc_version)\nelse:\n    version_tuple = (8, 0, 3, vc_version)\n'
    expect(renpyVersionFromVc('vc_version = 22090809', both)).toBe('8.0.3.22090809')
    expect(renpyVersionFromVc('vc_version = 22090809', both, 3)).toBe('8.0.3.22090809')
    // Harem Hotel ships only lib/python2.7: it runs the Python 2 build, Ren'Py 7.
    expect(renpyVersionFromVc('vc_version = 2266', both, 2)).toBe('7.5.3.2266')
    expect(pythonOf(['G/lib/python2.7/os.pyo', 'G/lib/windows-x86_64/python.exe'], 'G/')).toBe(2)
    expect(pythonOf(['G/lib/py3-windows-x86_64/python.exe', 'G/lib/py2-windows-x86_64/python.exe'], 'G/')).toBe(3)
    expect(pythonOf(['G/game/script.rpyc'], 'G/')).toBeUndefined()
  })
})
