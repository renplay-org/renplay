import sharp from 'sharp'

/** One rule of progressive_download.txt: (+ stream / - keep in game.zip, type, pattern). */
export interface ProgressiveRule {
  stream: boolean
  type: 'image' | 'music' | 'voice'
  pattern: RegExp
}

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

const IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i

/** True when the web build will stream this image (path relative to the project, e.g. "game/images/a.png"). */
export function streamsImage(path: string, rules: ProgressiveRule[]): boolean {
  if (!IMAGE_EXT.test(path)) return false
  for (const r of rules) {
    if (r.type !== 'image') continue
    if (r.pattern.test(path) || r.pattern.test('/' + path)) return r.stream
  }
  return false
}

/**
 * The low-resolution stand-in Ren'Py shows until a streamed image arrives:
 * 1/32 of the size, block-averaged, as PNG. Same result as the launcher's
 * pixellate-and-scale, computed in parallel here instead of one by one there.
 */
export async function makePlaceholder(data: Buffer): Promise<{ png: Buffer; width: number; height: number } | null> {
  try {
    const img = sharp(data, { failOn: 'none', animated: false, limitInputPixels: 16383 * 16383 })
    const meta = await img.metadata()
    if (!meta.width || !meta.height) return null
    const { width, height } = meta
    const out =
      width > 32 && height > 32
        ? img.resize(Math.floor(width / 32), Math.floor(height / 32), { fit: 'fill', kernel: 'linear' })
        : img
    return { png: await out.png({ compressionLevel: 9 }).toBuffer(), width, height }
  } catch {
    return null
  }
}

/** Ren'Py launcher extension that picks up the placeholders above (see sdk.ts). */
export const LAUNCHER_PATCH = `# Installed by renplay. Uses placeholders renplay generated in parallel instead
# of decoding every streamed image again, one at a time. Without the
# RENPLAY_PLACEHOLDERS environment variable the launcher behaves as usual.
init 100 python:
    import os as _rp_os, json as _rp_json, zipfile as _rp_zipfile

    def _renplay_finalize(self, _orig=ProgressiveFilter.finalize):
        root = _rp_os.environ.get("RENPLAY_PLACEHOLDERS")
        if not root:
            return _orig(self)
        try:
            with open(_rp_os.path.join(root, "index.json")) as f:
                dims = _rp_json.load(f)
        except Exception:
            return _orig(self)
        zout = _rp_zipfile.ZipFile(_rp_os.path.join(self.destination, "game.zip"), "a")
        rest = [ ]
        for (src, dst) in self.images:
            rel = dst[len("game/"):]
            d = dims.get(rel)
            ph = _rp_os.path.join(root, "files", rel)
            if d is None or not _rp_os.path.exists(ph):
                rest.append((src, dst))
                continue
            self.remote_files[rel] = "image {},{}".format(d[0], d[1])
            zout.write(ph, _rp_os.path.join("_placeholders", rel))
        zout.close()
        print("renplay: used %d prepared placeholders, %d left for Ren'Py" % (len(self.images) - len(rest), len(rest)))
        self.images = rest
        return _orig(self)

    ProgressiveFilter.finalize = _renplay_finalize

    # build_web() finishes by zipping the whole build again into <dest>.zip for
    # itch.io uploads. renplay serves the folder, so skip writing that copy.
    class _RenplayNullZip(object):
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def write(self, *args, **kwargs):
            pass
        def writestr(self, *args, **kwargs):
            pass
        def close(self):
            pass

    class _RenplayZipfile(object):
        def __getattr__(self, name):
            return getattr(_rp_zipfile, name)
        def ZipFile(self, file, mode="r", *args, **kwargs):
            if (_rp_os.environ.get("RENPLAY_SKIP_WEB_ZIP") and mode == "w" and isinstance(file, str)
                    and file.endswith(".zip") and not file.endswith("game.zip")):
                return _RenplayNullZip()
            return _rp_zipfile.ZipFile(file, mode, *args, **kwargs)

    zipfile = _RenplayZipfile()
`
