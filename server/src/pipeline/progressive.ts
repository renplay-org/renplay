import sharp from 'sharp'

/** One rule of progressive_download.txt: (+ stream / - keep in game.zip, type, pattern). */
export interface ProgressiveRule {
  stream: boolean
  type: 'image' | 'music' | 'voice'
  pattern: RegExp
}

/** Default rules: GUI stays in game.zip, everything else streams. */
export const DEFAULT_PROGRESSIVE_RULES = `# First matching rule wins. '+' streams on demand, '-' keeps the file in game.zip.
- image game/gui/**
+ image game/**
- music game/gui/**
+ music game/**
+ voice game/**
`

/** Ren'Py's distribute.match: ** any, * any but "/", [abc] classes, case-insensitive. */
export function compileMatch(pattern: string): RegExp {
  let re = ''
  let p = pattern
  while (p) {
    if (p.startsWith('**')) {
      re += '.*'
      p = p.slice(2)
    } else if (p[0] === '*') {
      re += '[^/]*/?'
      p = p.slice(1)
    } else if (p[0] === '[') {
      const end = p.indexOf(']')
      const body = end === -1 ? p.slice(1) : p.slice(1, end)
      re += `[${body.replace(/\\/g, '\\\\')}]`
      p = end === -1 ? '' : p.slice(end + 1)
    } else {
      re += p[0]!.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
      p = p.slice(1)
    }
  }
  return new RegExp(`^${re}$`, 'i')
}

/**
 * Streaming rules for a build: files matching `keep` (globs relative to
 * game/) go into game.zip, then the defaults apply.
 */
export function buildRules(keep: string[] = [], base = DEFAULT_PROGRESSIVE_RULES): string {
  const lines = keep.flatMap((g) => {
    const glob = g.replace(/^\/+/, '').replace(/^game\//, '')
    return [`- image game/${glob}`, `- music game/${glob}`, `- voice game/${glob}`]
  })
  return lines.length ? `${lines.join('\n')}\n${base}` : base
}

/** Matcher for `exclude` globs (relative to game/). */
export function excluder(globs: string[] = []): (rel: string) => boolean {
  const res = globs.map((g) => compileMatch(g.replace(/^\/+/, '').replace(/^game\//, '')))
  return (rel) => res.some((r) => r.test(rel))
}

export function parseRules(text: string): ProgressiveRule[] {
  const rules: ProgressiveRule[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const m = line.match(/^([+-]) (image|music|voice) (.+)$/)
    if (!m) continue
    rules.push({ stream: m[1] === '+', type: m[2] as ProgressiveRule['type'], pattern: compileMatch(m[3]!) })
  }
  return rules
}

function ruleMatches(rules: ProgressiveRule[], path: string, type: ProgressiveRule['type']): boolean {
  for (const r of rules) {
    if (r.type !== type) continue
    if (r.pattern.test(path) || r.pattern.test('/' + path)) return r.stream
  }
  return false
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|svg)$/i
const AUDIO_EXT = /\.(wav|mp2|mp3|ogg|opus)$/i
const VIDEO_EXT = /\.(ogv|webm|mp4|mkv|avi)$/i

export type StreamKind = 'image' | 'music' | 'voice' | 'video'

/**
 * How Ren'Py's web build treats a file (path relative to game/): streamed as
 * image/music/voice/video, or null when it belongs in game.zip. Mirrors the
 * launcher's ProgressiveFilter: videos always stream.
 */
export function classify(rel: string, rules: ProgressiveRule[]): StreamKind | null {
  const path = `game/${rel}`
  if (IMAGE_EXT.test(rel) && ruleMatches(rules, path, 'image')) return 'image'
  if (AUDIO_EXT.test(rel)) {
    if (ruleMatches(rules, path, 'music')) return 'music'
    if (ruleMatches(rules, path, 'voice')) return 'voice'
  }
  if (VIDEO_EXT.test(rel)) return 'video'
  return null
}

export function streamsImage(rel: string, rules: ProgressiveRule[]): boolean {
  return classify(rel, rules) === 'image'
}

export interface Placeholder {
  data: Buffer
  width: number
  height: number
}

/**
 * The low-resolution stand-in Ren'Py shows until a streamed image arrives:
 * 1/32 of the size, as WebP. Ren'Py's own builds use PNG, which is 10-20x
 * larger; placeholders are part of game.zip, so this shrinks the first
 * download of big games by tens of MB.
 */
export async function makePlaceholder(data: Buffer): Promise<Placeholder | null> {
  try {
    const img = sharp(data, { failOn: 'none', animated: false, limitInputPixels: 16383 * 16383 })
    const meta = await img.metadata()
    if (!meta.width || !meta.height) return null
    const { width, height } = meta
    const small = width > 32 && height > 32
    const out = small ? img.resize(Math.floor(width / 32), Math.floor(height / 32), { fit: 'fill', kernel: 'linear' }) : img
    return { data: await out.webp({ quality: 60, alphaQuality: 80, effort: 4 }).toBuffer(), width, height }
  } catch {
    return null
  }
}
