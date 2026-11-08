import type { Readable } from 'node:stream'
import type { SourceEntry } from './archive.js'
import { detectLayout, type Layout } from './project.js'
import type { EngineInfo, Family } from '../shared/api.js'

/**
 * Engine families. Ren'Py is what Renplay is for; the others are recognized so
 * a download says what it is, and some of them install (see INSTALLABLE).
 * docs.renplay.org/engines has the plan for each.
 */

/** Families this version of Renplay can install. */
export const INSTALLABLE = new Set<Family>(['renpy', 'html'])

const NOT_YET = 'Renplay recognizes it, but cannot install it yet.'

/** Reads the start of an entry without the rest (works for compressed entries too). */
async function head(e: SourceEntry, n: number): Promise<Buffer> {
  const s: Readable = await e.open(e.seekable ? { start: 0, end: Math.min(e.size, n) } : undefined)
  const chunks: Buffer[] = []
  let got = 0
  for await (const c of s) {
    chunks.push(c as Buffer)
    got += (c as Buffer).length
    if (got >= n) break
  }
  s.destroy()
  return Buffer.concat(chunks).subarray(0, n)
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1)
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

function info(family: Family, root: string, o: Partial<EngineInfo> & { label: string }): EngineInfo {
  const installable = INSTALLABLE.has(family)
  return { family, root, warnings: [], installable, reason: installable ? undefined : NOT_YET, ...o }
}

/** Twine stories: Twine 2 (tw-storydata) or Twine 1 style (store-area, as Tweego writes SugarCube). */
function twine(html: string): { kind: string; version?: string; label: string; title?: string } | null {
  const tw2 = html.match(/<tw-storydata\b[^>]*>/)
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
  if (tw2) {
    const format = attr(tw2[0], 'format') ?? 'Twine'
    const version = attr(tw2[0], 'format-version')
    return { kind: `twine-${format.toLowerCase()}`, version, label: `HTML (${format}${version ? ` ${version}` : ''})`, title: attr(tw2[0], 'name') }
  }
  if (!/<div id="(store-area|storeArea)"/.test(html)) return null
  const sc = html.match(/title:"SugarCube",major:(\d+),minor:(\d+),patch:(\d+)/)
  const title = html.match(/<div tiddler="StoryTitle"[^>]*>([^<]*)</)?.[1]?.trim()
  if (sc) {
    const version = `${sc[1]}.${sc[2]}.${sc[3]}`
    return { kind: 'twine-sugarcube', version, label: `HTML (SugarCube ${version})`, title }
  }
  return { kind: 'twine-1', label: 'HTML (Twine 1)', title }
}

/** A readable name from a file name: "Sexting_sim_stories_V0.17.0-release-free" → "Sexting sim stories". */
export function nameFromFile(name: string): string {
  const words = name.replace(/[_]+/g, ' ').trim()
  return words.split(/[ -]v?\d+(\.\d+)+/i)[0]!.trim() || words
}

const htmlTitle = (html: string) => html.match(/<title>([^<]{1,200})<\/title>/i)?.[1]?.trim()

/**
 * What made the game in an archive. Ren'Py comes first: a Ren'Py game's
 * folder may hold an index.html or DLLs of its own.
 */
export async function detectEngine(entries: SourceEntry[], layout: Layout | null = detectLayout(entries)): Promise<EngineInfo | null> {
  if (layout?.kind === 'project') return info('renpy', layout.root, { label: "Ren'Py" })
  if (layout?.kind === 'web') {
    return { ...info('renpy', layout.root, { label: "Ren'Py web build" }), installable: false, reason: 'This is a web build. Use the game’s PC download; Renplay builds the web version itself.' }
  }
  const files = entries.filter((e) => !e.path.endsWith('/') && !e.path.includes('__MACOSX/'))
  const find = (re: RegExp) => files.find((e) => re.test(e.path))
  // Shallowest first: the game's own files, not a bundled sample.
  const all = (re: RegExp) => files.filter((e) => re.test(e.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length)

  // Godot: a .pck next to the program (the PC export), or a web export.
  const pck = all(/\.pck$/i)[0]
  if (pck) {
    const root = dirOf(pck.path)
    const h = await head(pck, 24)
    const warnings: string[] = []
    let version: string | undefined
    if (h.subarray(0, 4).toString('latin1') === 'GDPC' && h.length >= 24) {
      version = `${h.readUInt32LE(8)}.${h.readUInt32LE(12)}.${h.readUInt32LE(16)}`
      if (h.readUInt32LE(4) >= 2 && h.readUInt32LE(20) & 1) {
        return { ...info('godot', root, { label: `Godot ${version}`, version, entry: baseOf(pck.path) }), installable: false, reason: 'Its files are encrypted, which only the developer’s own web export can read.' }
      }
    }
    // Native plugins (GDExtension) ship as libraries next to the program; C# builds bring a data_ folder.
    const native = files.filter((e) => dirOf(e.path) === root && /\.(dll|so|dylib)$/i.test(e.path)).map((e) => baseOf(e.path))
    if (native.length) warnings.push(`It uses a native plugin (${native.join(', ')}) that browsers cannot load, so parts of it, or all of it, may not work.`)
    if (files.some((e) => e.path.startsWith(root) && /\/GodotSharp\.dll$/i.test(e.path))) warnings.push('It is written in C#, which Godot cannot export to the web yet.')
    const name = nameFromFile(baseOf(pck.path).replace(/\.pck$/i, ''))
    // The developer's own web export: the pack with its engine (.wasm) and the page that starts
    // it. A web page already, installed like HTML games (pipeline/html.ts).
    const stem = pck.path.replace(/\.pck$/i, '')
    const page = files.find((e) => dirOf(e.path) === root && /\.html?$/i.test(e.path) && !/\.offline\.html$/i.test(e.path))
    if (page && files.some((e) => e.path === `${stem}.wasm`) && !native.length) {
      const html = page.size < 4 << 20 ? (await head(page, page.size)).toString('utf-8') : ''
      if (/GODOT_CONFIG|new Engine\(/.test(html)) {
        const label = version ? `Godot ${version} (web build)` : 'Godot (web build)'
        if (/GODOT_THREADS_ENABLED\s*=\s*true/.test(html)) {
          return { ...info('godot', root, { kind: 'godot-web', label, version, entry: baseOf(page.path), title: htmlTitle(html) ?? name }), installable: false, reason: 'This web build needs threads (SharedArrayBuffer), which Renplay cannot give it yet.' }
        }
        return { ...info('godot', root, { kind: 'godot-web', label, version, entry: baseOf(page.path), title: htmlTitle(html) ?? name }), installable: true, reason: undefined }
      }
    }
    return {
      ...info('godot', root, { label: version ? `Godot ${version}` : 'Godot', version, entry: baseOf(pck.path), title: name, warnings }),
      reason: 'This is a PC build. Renplay installs Godot games from their web build (on itch.io, the version you can play in the browser); PC builds are planned.',
    }
  }

  // Unity: a WebGL build runs in browsers; a PC build is a program for one system.
  const loader = all(/(^|\/)Build\/[^/]*\.loader\.js$|(^|\/)Build\/UnityLoader\.js$/i)[0]
  if (loader) {
    const root = dirOf(loader.path).replace(/Build\/$/i, '')
    // The page's loader config names the product: productName: "NaughtyPhone".
    const page = files.find((e) => e.path === `${root}index.html`)
    const html = page && page.size < 4 << 20 ? (await head(page, page.size)).toString('utf-8') : ''
    const title = html.match(/productName\s*:\s*["']([^"']{1,120})["']/)?.[1] ?? htmlTitle(html)
    // A web page already, installed like HTML games (pipeline/html.ts).
    return { ...info('unity', root, { kind: 'unity-webgl', label: 'Unity (WebGL build)', entry: 'index.html', title }), installable: true, reason: undefined }
  }
  const ggm = all(/_Data\/globalgamemanagers$|_Data\/data\.unity3d$/i)[0]
  if (ggm || find(/(^|\/)UnityPlayer\.(dll|so)$/i)) {
    const dataDir = ggm ? ggm.path.slice(0, ggm.path.lastIndexOf('_Data/') + 6) : ''
    const version = ggm ? (await head(ggm, 4096)).toString('latin1').match(/\b(\d{4}\.\d+\.\d+[abfpx]\d+)\b/)?.[1] : undefined
    return {
      ...info('unity', dataDir ? dirOf(dataDir.slice(0, -1)) : '', { kind: 'unity-desktop', label: `Unity${version ? ` ${version}` : ''} (PC build)`, version, title: dataDir ? baseOf(dataDir.slice(0, -6)) : undefined }),
      installable: false,
      reason: `Unity games run in a browser only as a WebGL build, which the developer makes; this is a PC build.`,
    }
  }

  // RPG Maker MV and MZ are HTML5 games (in NW.js on PCs).
  const rm = all(/(^|\/)js\/(rpg_core|rmmz_core)\.js$/i)[0]
  if (rm) {
    const mz = /rmmz_core\.js$/i.test(rm.path)
    const root = dirOf(rm.path).replace(/js\/$/i, '')
    const version = (await head(rm, 1 << 16)).toString('utf-8').match(/RPGMAKER_VERSION\s*=\s*["']([\d.]+)["']/)?.[1]
    const label = `RPGM (${mz ? 'MZ' : 'MV'}${version ? ` ${version}` : ''})`
    return info('html', root, { kind: mz ? 'rpgmaker-mz' : 'rpgmaker-mv', version, label, entry: 'index.html' })
  }
  const tyrano = all(/(^|\/)tyrano\/(tyrano\.base\.js|libs\.js)$/i)[0]
  if (tyrano) return info('html', dirOf(tyrano.path).replace(/tyrano\/$/i, ''), { kind: 'tyrano', label: 'HTML (TyranoScript)', entry: 'index.html' })
  const construct = all(/(^|\/)(c2runtime|c3runtime)\.js$/i)[0]
  if (construct) {
    const root = dirOf(construct.path).replace(/scripts\/$/i, '')
    return info('html', root, { kind: /c3/i.test(construct.path) ? 'construct-3' : 'construct-2', label: /c3/i.test(construct.path) ? 'HTML (Construct 3)' : 'HTML (Construct 2)', entry: 'index.html' })
  }

  // Engines that only make PC programs.
  if (find(/(^|\/)Game\.rgss(ad|2a|3a)$/i) || find(/(^|\/)System\/RGSS\d+\w*\.dll$/i)) {
    return { ...info('rpgmaker-rgss', '', { label: 'RPGM (XP, VX or VX Ace)' }), reason: 'It is a Windows program (Ruby), which browsers cannot run.' }
  }
  if (find(/(^|\/)Data\.wolf$|(^|\/)Data\/[^/]+\.wolf$/i)) return { ...info('wolf', '', { label: 'Wolf RPG' }), reason: 'It is a Windows program, which browsers cannot run.' }
  if (find(/(^|\/)data\.xp3$/i)) return { ...info('kirikiri', '', { label: 'Kirikiri' }), reason: 'It is a Windows program, which browsers cannot run.' }
  if (find(/\/Content\/Paks\/[^/]+\.pak$/i)) return { ...info('unreal', '', { label: 'Unreal Engine' }), reason: 'It is a PC program, which browsers cannot run.' }
  if (find(/(^|\/)data\.win$/i)) return { ...info('gamemaker', '', { label: 'GameMaker' }), reason: 'It is a Windows program, which browsers cannot run.' }

  // Plain HTML: a Twine story or any page with its files. The shallowest page, preferring index.html.
  const pages = all(/\.html?$/i)
  const page = pages.find((e) => /(^|\/)index\.html?$/i.test(e.path) && e.path.split('/').length === pages[0]!.path.split('/').length) ?? pages[0]
  if (page) {
    const html = page.size <= 64 << 20 ? (await head(page, page.size)).toString('utf-8') : ''
    const tw = twine(html)
    const root = dirOf(page.path)
    if (tw) return info('html', root, { kind: tw.kind, version: tw.version, label: tw.label, title: tw.title ?? htmlTitle(html), entry: baseOf(page.path) })
    return info('html', root, { kind: 'html', label: 'HTML', title: htmlTitle(html), entry: baseOf(page.path) })
  }

  const swf = all(/\.swf$/i)[0]
  if (swf) return { ...info('flash', dirOf(swf.path), { label: 'Flash', entry: baseOf(swf.path) }), reason: 'Flash games are not supported yet.' }
  return null
}
