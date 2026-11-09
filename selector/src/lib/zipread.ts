/** One file in a zip, read only when asked. */
interface ZipEntry {
  name: string
  size: number
  /** Modified time in milliseconds, from the zip's local date and time (two-second steps). */
  mtime: number
  read(): Promise<Blob>
}

/**
 * Lists a zip's files from its central directory and reads each on demand, decompressing with the
 * browser's own deflate-raw stream. Plain zips only: no zip64 and no encryption, which a zipped
 * Ren'Py folder never needs.
 */
export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const tailSize = Math.min(file.size, 65_557)
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer())
  let eocd = -1
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('This is not a zip file.')
  const count = tail.getUint16(eocd + 10, true)
  const dirSize = tail.getUint32(eocd + 12, true)
  const dirOffset = tail.getUint32(eocd + 16, true)
  if (dirOffset === 0xffffffff || count === 0xffff) throw new Error('This zip is too large to read here.')
  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer())
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let p = 0
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (dir.getUint32(p, true) !== 0x02014b50) break
    const method = dir.getUint16(p + 10, true)
    const time = dir.getUint16(p + 12, true)
    const date = dir.getUint16(p + 14, true)
    const packed = dir.getUint32(p + 20, true)
    const size = dir.getUint32(p + 24, true)
    const nameLength = dir.getUint16(p + 28, true)
    const extraLength = dir.getUint16(p + 30, true)
    const commentLength = dir.getUint16(p + 32, true)
    const local = dir.getUint32(p + 42, true)
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength))
    p += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    const mtime = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime()
    entries.push({
      name,
      size,
      mtime,
      async read() {
        const head = new DataView(await file.slice(local, local + 30).arrayBuffer())
        const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true)
        const data = file.slice(start, start + packed)
        if (method === 0) return data
        if (method !== 8) throw new Error(`${name} uses a compression this browser cannot read.`)
        return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
      },
    })
  }
  return entries
}
