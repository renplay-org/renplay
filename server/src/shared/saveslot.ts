// What a Ren'Py save file's name says about its slot, for the server and the library alike.

export interface SlotInfo {
  kind: 'manual' | 'auto' | 'quick' | 'internal'
  page?: string
  slot?: string
  label: string
}

/** Interprets Ren'Py save file names such as `3-2-LT1.save` or `auto-1-LT1.save`. */
export function slotInfo(file: string): SlotInfo {
  const base = file.replace(/-LT\d+\.save$/, '').replace(/\.save$/, '')
  if (base.startsWith('_')) return { kind: 'internal', label: base }
  const m = base.match(/^(.*)-(\w+)$/)
  if (!m) return { kind: 'manual', label: base }
  const [, page, slot] = m
  if (page === 'auto') return { kind: 'auto', page, slot, label: `Auto ${slot}` }
  if (page === 'quick') return { kind: 'quick', page, slot, label: `Quick ${slot}` }
  return { kind: 'manual', page, slot, label: `Page ${page} · Slot ${slot}` }
}
