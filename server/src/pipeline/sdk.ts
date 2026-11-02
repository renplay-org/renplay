import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { arch } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from '../config.js'
import type { JobContext } from '../jobs.js'
import { exists } from '../util/fsx.js'
import { extractWithBsdtar } from './archive.js'
import { LAUNCHER_PATCH } from './progressive.js'

const BASE = 'https://www.renpy.org/dl'

export class SdkManager {
  private ensuring: Promise<string> | null = null

  constructor(private readonly cfg: Config) {}

  path(version = this.cfg.sdkVersion): string {
    return join(this.cfg.sdkDir, `renpy-${version}`)
  }

  async installed(): Promise<string[]> {
    try {
      const names = await readdir(this.cfg.sdkDir)
      const out: string[] = []
      for (const n of names) if (n.startsWith('renpy-') && (await exists(join(this.cfg.sdkDir, n, '.renplay-ready')))) out.push(n.slice(6))
      return out
    } catch {
      return []
    }
  }

  async ensure(ctx?: JobContext, version = this.cfg.sdkVersion): Promise<string> {
    const dir = this.path(version)
    if (!(await exists(join(dir, '.renplay-ready')))) {
      this.ensuring ??= this.install(version, ctx).finally(() => (this.ensuring = null))
      await this.ensuring
    }
    await this.patchLauncher(dir)
    return dir
  }

  /** Keeps renplay's launcher extension (fast placeholders) installed and current. */
  private async patchLauncher(dir: string): Promise<void> {
    const file = join(dir, 'launcher', 'game', 'zz_renplay.rpy')
    let current = ''
    try {
      current = await readFile(file, 'utf-8')
    } catch {}
    if (current !== LAUNCHER_PATCH) {
      await writeFile(file, LAUNCHER_PATCH)
      await rm(file + 'c', { force: true })
    }
  }

  private async install(version: string, ctx?: JobContext): Promise<string> {
    const dir = this.path(version)
    const dl = join(this.cfg.sdkDir, '.download')
    await mkdir(dl, { recursive: true })
    const sums = await fetchChecksums(version)
    const sdkFile = `renpy-${version}-${arch() === 'arm64' ? 'sdkarm' : 'sdk'}.tar.bz2`
    const webFile = `renpy-${version}-web.zip`
    for (const f of [sdkFile, webFile]) {
      if (!sums.has(f)) throw new Error(`No checksum published for ${f}`)
      const target = join(dl, f)
      if (!(await exists(target))) {
        ctx?.progress('Downloading Ren’Py SDK', 0, f)
        ctx?.log(`Downloading ${BASE}/${version}/${f}`)
        await download(`${BASE}/${version}/${f}`, target, sums.get(f)!, ctx)
      }
    }
    ctx?.progress('Installing Ren’Py SDK', 0.5)
    const tmp = join(this.cfg.sdkDir, `.tmp-${version}-${Date.now()}`)
    await extractWithBsdtar(join(dl, sdkFile), tmp, ctx?.signal ?? new AbortController().signal)
    const top = (await readdir(tmp)).find((n) => n.startsWith('renpy-'))
    if (!top) throw new Error('Unexpected SDK archive layout')
    const sdkRoot = join(tmp, top)
    await extractWithBsdtar(join(dl, webFile), sdkRoot, ctx?.signal ?? new AbortController().signal)
    if (!(await exists(join(sdkRoot, 'web', 'renpy.wasm')))) throw new Error('Web support did not unpack into the SDK')
    await rm(dir, { recursive: true, force: true })
    await rename(sdkRoot, dir)
    await rm(tmp, { recursive: true, force: true })
    await writeFile(join(dir, '.renplay-ready'), new Date().toISOString())
    await rm(dl, { recursive: true, force: true })
    ctx?.log(`Ren'Py SDK ${version} installed at ${dir}`)
    return dir
  }

  private env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...extra,
      SDL_VIDEODRIVER: 'dummy',
      SDL_AUDIODRIVER: 'dummy',
      HOME: join(this.cfg.internalDir, 'home'),
      RENPY_LESS_UPDATES: '1',
    }
  }

  async webBuild(sdk: string, project: string, dest: string, ctx: JobContext, opts: { placeholders?: string } = {}): Promise<void> {
    await mkdir(join(this.cfg.internalDir, 'home'), { recursive: true })
    const env = opts.placeholders ? { RENPLAY_PLACEHOLDERS: opts.placeholders } : {}
    await this.run(sdk, [join(sdk, 'launcher'), 'web_build', project, '--destination', dest], ctx, 'Building for web', env)
    if (!(await exists(join(dest, 'index.html'))) || !(await exists(join(dest, 'game.zip')))) {
      throw new Error('The Ren’Py web build did not produce index.html and game.zip (see log)')
    }
  }

  async compile(sdk: string, project: string, ctx: JobContext): Promise<void> {
    await mkdir(join(this.cfg.internalDir, 'home'), { recursive: true })
    await this.run(sdk, [project, 'compile', '--keep-orphan-rpyc'], ctx, 'Compiling scripts')
  }

  private run(sdk: string, args: string[], ctx: JobContext, stage: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn(join(sdk, 'renpy.sh'), args, { cwd: sdk, env: this.env(env), signal: ctx.signal, stdio: ['ignore', 'pipe', 'pipe'] })
      const tail: string[] = []
      let lastLogged = ''
      let lastAt = 0
      const onData = (d: Buffer) => {
        for (const raw of d.toString().split(/[\r\n]+/)) {
          const line = raw.trim()
          if (!line) continue
          const m = line.match(/^(.*?)\s*-\s*(\d+)\s+of\s+(\d+)$/)
          if (m) {
            const [, what, a, b] = m
            ctx.progress(stage, Number(a) / Math.max(1, Number(b)), `${what} ${a}/${b}`)
            const now = Date.now()
            if (what !== lastLogged || now - lastAt > 15_000) {
              ctx.log(`${what} ${a}/${b}`)
              lastLogged = what!
              lastAt = now
            }
            continue
          }
          ctx.log(line)
          tail.push(line)
          if (tail.length > 40) tail.shift()
        }
      }
      p.stdout.on('data', onData)
      p.stderr.on('data', onData)
      p.on('error', reject)
      p.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Ren'Py exited with code ${code}: ${tail.slice(-6).join(' | ')}`))
      })
    })
  }
}

async function fetchChecksums(version: string): Promise<Map<string, string>> {
  const res = await fetch(`${BASE}/${version}/checksums.txt`)
  if (!res.ok) throw new Error(`Cannot fetch Ren'Py checksums (${res.status})`)
  const text = await res.text()
  const out = new Map<string, string>()
  let section = ''
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (s.startsWith('# ')) section = s.slice(2)
    const m = s.match(/^([0-9a-f]{64})\s+(\S+)$/)
    if (section === 'sha256' && m) out.set(m[2]!, m[1]!)
  }
  return out
}

async function download(url: string, target: string, sha256: string, ctx?: JobContext): Promise<void> {
  const res = await fetch(url, { signal: ctx?.signal })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  let got = 0
  const tmp = `${target}.part`
  const body = Readable.fromWeb(res.body as any)
  body.on('data', (c: Buffer) => {
    hash.update(c)
    got += c.length
    if (total) ctx?.progress('Downloading Ren’Py SDK', got / total)
  })
  await pipeline(body, createWriteStream(tmp))
  const digest = hash.digest('hex')
  if (digest !== sha256) {
    await rm(tmp, { force: true })
    throw new Error(`Checksum mismatch for ${url}`)
  }
  await rename(tmp, target)
}
