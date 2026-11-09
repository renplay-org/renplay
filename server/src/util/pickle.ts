/**
 * A data-only Python unpickler.
 *
 * It never resolves or calls anything: class references become `PyGlobal`
 * markers and object construction becomes `PyObject` records holding the
 * constructor arguments and state. That makes it safe for pickles taken from
 * untrusted game archives (RPA indexes, .rpyc scripts).
 */

export class PyGlobal {
  constructor(readonly name: string) {}
}

export class PyObject {
  args: unknown[] = []
  state: unknown = undefined
  items: unknown[] = []
  dict: Map<unknown, unknown> | null = null
  constructor(readonly cls: string) {}

  /** Returns a named attribute from the pickled state (dict or slot state). */
  attr(name: string): unknown {
    const st = this.state
    if (st instanceof Map) return st.get(name)
    if (Array.isArray(st)) {
      for (const part of st) if (part instanceof Map && part.has(name)) return part.get(name)
    }
    return undefined
  }
}

class UnpicklingError extends Error {}

export interface UnpickleOptions {
  /** Hard limit on decoded container elements, guards against pickle bombs. */
  maxItems?: number
}

export function unpickle(buf: Uint8Array, opts: UnpickleOptions = {}): unknown {
  const maxItems = opts.maxItems ?? 50_000_000
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder('utf-8')
  let pos = 0
  let items = 0
  const stack: unknown[] = []
  const metastack: unknown[][] = []
  const memo = new Map<number, unknown>()

  const need = (n: number) => {
    if (pos + n > buf.length) throw new UnpicklingError('Truncated pickle')
  }
  const u8 = () => {
    need(1)
    return buf[pos++]!
  }
  const u16 = () => {
    need(2)
    const v = view.getUint16(pos, true)
    pos += 2
    return v
  }
  const u32 = () => {
    need(4)
    const v = view.getUint32(pos, true)
    pos += 4
    return v
  }
  const i32 = () => {
    need(4)
    const v = view.getInt32(pos, true)
    pos += 4
    return v
  }
  const u64 = () => {
    need(8)
    const v = view.getBigUint64(pos, true)
    pos += 8
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnpicklingError('Length too large')
    return Number(v)
  }
  const bytes = (n: number) => {
    need(n)
    const b = buf.subarray(pos, pos + n)
    pos += n
    return b
  }
  const line = () => {
    const start = pos
    while (pos < buf.length && buf[pos] !== 0x0a) pos++
    if (pos >= buf.length) throw new UnpicklingError('Unterminated line')
    const s = new TextDecoder('latin1').decode(buf.subarray(start, pos))
    pos++
    return s
  }
  const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
  const pop = () => {
    if (!stack.length) throw new UnpicklingError('Stack underflow')
    return stack.pop()
  }
  const popMark = (): unknown[] => {
    const items = stack.splice(0)
    const prev = metastack.pop()
    if (!prev) throw new UnpicklingError('Mark not found')
    stack.push(...prev)
    return items
  }
  const count = (n = 1) => {
    items += n
    if (items > maxItems) throw new UnpicklingError('Pickle too large')
  }
  const longFromBytes = (b: Uint8Array): number | bigint => {
    if (b.length === 0) return 0
    let v = 0n
    for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!)
    if (b[b.length - 1]! & 0x80) v -= 1n << BigInt(b.length * 8)
    if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v)
    return v
  }

  const construct = (callable: unknown, args: unknown[]): unknown => {
    if (callable instanceof PyGlobal) {
      const n = callable.name
      if (n === '_codecs.encode' && typeof args[0] === 'string') {
        const s = args[0]
        const out = new Uint8Array(s.length)
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
        return out
      }
      if (n === 'builtins.bytes' || n === '__builtin__.bytes') return args[0] ?? new Uint8Array()
      if (n === 'builtins.bytearray' || n === '__builtin__.bytearray') return args[0] ?? new Uint8Array()
      if (n === 'builtins.set' || n === 'builtins.frozenset' || n === '__builtin__.set' || n === '__builtin__.frozenset')
        return Array.isArray(args[0]) ? [...(args[0] as unknown[])] : []
      if ((n === 'copy_reg._reconstructor' || n === 'copyreg._reconstructor') && args[0] instanceof PyGlobal) {
        return new PyObject(args[0].name)
      }
      if (n === 'copyreg.__newobj__' || n === 'copy_reg.__newobj__') {
        const [cls, ...rest] = args
        const o = new PyObject(cls instanceof PyGlobal ? cls.name : '?')
        o.args = rest
        return o
      }
      const o = new PyObject(n)
      o.args = args
      return o
    }
    if (callable instanceof PyObject) {
      const o = new PyObject(callable.cls)
      o.args = args
      return o
    }
    const o = new PyObject('?')
    o.args = args
    return o
  }

  const setItem = (target: unknown, k: unknown, v: unknown) => {
    count()
    if (target instanceof Map) target.set(k, v)
    else if (target instanceof PyObject) {
      if (!target.dict) target.dict = new Map()
      target.dict.set(k, v)
    } else throw new UnpicklingError('SETITEM on non-dict')
  }
  const append = (target: unknown, v: unknown) => {
    count()
    if (Array.isArray(target)) target.push(v)
    else if (target instanceof PyObject) target.items.push(v)
    else throw new UnpicklingError('APPEND on non-list')
  }

  for (;;) {
    const op = u8()
    switch (op) {
      case 0x80: // PROTO
        u8()
        break
      case 0x95: // FRAME
        u64()
        break
      case 0x2e: // STOP
        return pop()
      case 0x28: // MARK
        metastack.push(stack.splice(0))
        break
      case 0x30: // POP
        if (stack.length) stack.pop()
        else popMark()
        break
      case 0x31: // POP_MARK
        popMark()
        break
      case 0x32: // DUP
        stack.push(stack[stack.length - 1])
        break
      case 0x4e: // NONE
        stack.push(null)
        break
      case 0x88: // NEWTRUE
        stack.push(true)
        break
      case 0x89: // NEWFALSE
        stack.push(false)
        break
      case 0x4a: // BININT
        stack.push(i32())
        break
      case 0x4b: // BININT1
        stack.push(u8())
        break
      case 0x4d: // BININT2
        stack.push(u16())
        break
      case 0x49: {
        // INT
        const s = line().trim()
        if (s === '00') stack.push(false)
        else if (s === '01') stack.push(true)
        else stack.push(parseInt(s, 10))
        break
      }
      case 0x4c: {
        // LONG
        const s = line().trim().replace(/L$/, '')
        const b = BigInt(s)
        stack.push(b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b)
        break
      }
      case 0x8a: // LONG1
        stack.push(longFromBytes(bytes(u8())))
        break
      case 0x8b: // LONG4
        stack.push(longFromBytes(bytes(i32())))
        break
      case 0x46: // FLOAT
        stack.push(parseFloat(line()))
        break
      case 0x47: {
        // BINFLOAT
        need(8)
        stack.push(view.getFloat64(pos, false))
        pos += 8
        break
      }
      case 0x53: {
        // STRING (protocol 0, repr-quoted)
        const s = line().trim()
        stack.push(s.slice(1, -1))
        break
      }
      case 0x54: // BINSTRING
        stack.push(latin1(bytes(i32())))
        break
      case 0x55: // SHORT_BINSTRING
        stack.push(latin1(bytes(u8())))
        break
      case 0x56: // UNICODE (raw-unicode-escape)
        stack.push(line())
        break
      case 0x58: // BINUNICODE
        stack.push(dec.decode(bytes(u32())))
        break
      case 0x8c: // SHORT_BINUNICODE
        stack.push(dec.decode(bytes(u8())))
        break
      case 0x8d: // BINUNICODE8
        stack.push(dec.decode(bytes(u64())))
        break
      case 0x42: // BINBYTES
        stack.push(bytes(u32()).slice())
        break
      case 0x43: // SHORT_BINBYTES
        stack.push(bytes(u8()).slice())
        break
      case 0x8e: // BINBYTES8
        stack.push(bytes(u64()).slice())
        break
      case 0x96: // BYTEARRAY8
        stack.push(bytes(u64()).slice())
        break
      case 0x29: // EMPTY_TUPLE
        stack.push([])
        break
      case 0x85: // TUPLE1
        stack.push([pop()])
        break
      case 0x86: {
        // TUPLE2
        const b = pop()
        const a = pop()
        stack.push([a, b])
        break
      }
      case 0x87: {
        // TUPLE3
        const c = pop()
        const b = pop()
        const a = pop()
        stack.push([a, b, c])
        break
      }
      case 0x74: // TUPLE
        stack.push(popMark())
        break
      case 0x5d: // EMPTY_LIST
        stack.push([])
        break
      case 0x6c: // LIST
        stack.push(popMark())
        break
      case 0x7d: // EMPTY_DICT
        stack.push(new Map())
        break
      case 0x64: {
        // DICT
        const it = popMark()
        const m = new Map()
        for (let i = 0; i + 1 < it.length; i += 2) m.set(it[i], it[i + 1])
        count(it.length / 2)
        stack.push(m)
        break
      }
      case 0x8f: // EMPTY_SET
        stack.push([])
        break
      case 0x90: {
        // ADDITEMS
        const it = popMark()
        const s = stack[stack.length - 1]
        if (Array.isArray(s)) s.push(...it)
        count(it.length)
        break
      }
      case 0x91: // FROZENSET
        stack.push(popMark())
        break
      case 0x61: {
        // APPEND
        const v = pop()
        append(stack[stack.length - 1], v)
        break
      }
      case 0x65: {
        // APPENDS
        const it = popMark()
        const target = stack[stack.length - 1]
        for (const v of it) append(target, v)
        break
      }
      case 0x73: {
        // SETITEM
        const v = pop()
        const k = pop()
        setItem(stack[stack.length - 1], k, v)
        break
      }
      case 0x75: {
        // SETITEMS
        const it = popMark()
        const target = stack[stack.length - 1]
        for (let i = 0; i + 1 < it.length; i += 2) setItem(target, it[i], it[i + 1])
        break
      }
      case 0x67: // GET
        stack.push(memo.get(parseInt(line(), 10)))
        break
      case 0x68: // BINGET
        stack.push(memo.get(u8()))
        break
      case 0x6a: // LONG_BINGET
        stack.push(memo.get(u32()))
        break
      case 0x70: // PUT
        memo.set(parseInt(line(), 10), stack[stack.length - 1])
        break
      case 0x71: // BINPUT
        memo.set(u8(), stack[stack.length - 1])
        break
      case 0x72: // LONG_BINPUT
        memo.set(u32(), stack[stack.length - 1])
        break
      case 0x94: // MEMOIZE
        memo.set(memo.size, stack[stack.length - 1])
        break
      case 0x63: {
        // GLOBAL
        const mod = line()
        const name = line()
        stack.push(new PyGlobal(`${mod}.${name}`))
        break
      }
      case 0x93: {
        // STACK_GLOBAL
        const name = pop()
        const mod = pop()
        stack.push(new PyGlobal(`${String(mod)}.${String(name)}`))
        break
      }
      case 0x52: {
        // REDUCE
        const args = pop()
        const callable = pop()
        stack.push(construct(callable, Array.isArray(args) ? args : []))
        break
      }
      case 0x81: {
        // NEWOBJ
        const args = pop()
        const cls = pop()
        const o = new PyObject(cls instanceof PyGlobal ? cls.name : '?')
        o.args = Array.isArray(args) ? args : []
        stack.push(o)
        break
      }
      case 0x92: {
        // NEWOBJ_EX
        pop() // kwargs
        const args = pop()
        const cls = pop()
        const o = new PyObject(cls instanceof PyGlobal ? cls.name : '?')
        o.args = Array.isArray(args) ? args : []
        stack.push(o)
        break
      }
      case 0x69: {
        // INST
        const mod = line()
        const name = line()
        const args = popMark()
        const o = new PyObject(`${mod}.${name}`)
        o.args = args
        stack.push(o)
        break
      }
      case 0x6f: {
        // OBJ
        const it = popMark()
        const cls = it.shift()
        const o = new PyObject(cls instanceof PyGlobal ? cls.name : '?')
        o.args = it
        stack.push(o)
        break
      }
      case 0x62: {
        // BUILD
        const state = pop()
        const target = stack[stack.length - 1]
        if (target instanceof PyObject) target.state = state
        else if (target instanceof Map && state instanceof Map) for (const [k, v] of state) target.set(k, v)
        break
      }
      case 0x50: // PERSID
      case 0x51: // BINPERSID
      case 0x82: // EXT1
      case 0x83: // EXT2
      case 0x84: // EXT4
      case 0x97: // NEXT_BUFFER
      case 0x98: // READONLY_BUFFER
        throw new UnpicklingError(`Unsupported pickle opcode 0x${op.toString(16)}`)
      default:
        throw new UnpicklingError(`Unknown pickle opcode 0x${op.toString(16)} at ${pos - 1}`)
    }
  }
}

/** Depth-first walk over every value reachable from `root`, visiting each once. */
export function walkPickle(root: unknown, visit: (v: unknown) => void): void {
  const seen = new Set<unknown>()
  const stack: unknown[] = [root]
  while (stack.length) {
    const v = stack.pop()
    if (v === null || typeof v !== 'object') {
      visit(v)
      continue
    }
    if (seen.has(v)) continue
    seen.add(v)
    visit(v)
    if (Array.isArray(v)) stack.push(...v)
    else if (v instanceof Map) for (const [k, x] of v) stack.push(k, x)
    else if (v instanceof PyObject) {
      stack.push(...v.args, v.state, ...v.items)
      if (v.dict) for (const [k, x] of v.dict) stack.push(k, x)
    }
  }
}
