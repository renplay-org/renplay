// Writes the snapshot of a running demo server into the static demo's output folder: demo/snapshot.json, the pictures
// the demo shows (api/art/*), the runtime, and for each Ren'Py game its page and the files of its build:
// g/<id>/<build>/{index.html,game.zip,game/*}. The engine is not copied: the page points at engines.renplay.org.
//
// The build's files are read from the demo image's seed output (`docker build --target export`, see demo.yml):
// <seed>/games/<id>/<build>/{game.zip,assets.pack,assets.json}. Nothing is read from a running container.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { capture } from './capture.mjs'

/**
 * @param {{ out: string, base: string, seed: string, embedder: string }} options
 * @returns {Promise<string[]>} the games captured
 */
export async function writeSnapshot({ out, base, seed, embedder }) {
  const write = (path, data) => {
    mkdirSync(dirname(join(out, path)), { recursive: true })
    writeFileSync(join(out, path), data)
  }
  const { snapshot, art, fetchArt, pages, runtime } = await capture({ base, embedder })
  for (const url of art) write(url.slice(1), await fetchArt(url))
  write('demo/snapshot.json', JSON.stringify(snapshot))
  if (runtime) write('renplay/runtime.js', runtime)
  for (const { id, build, html } of pages) {
    const dir = `g/${id}/${build}`
    write(`${dir}/index.html`, html)
    const from = join(seed, 'games', id, build)
    write(`${dir}/game.zip`, readFileSync(join(from, 'game.zip')))
    // The streamed assets: the server cuts them out of assets.pack by range, so here each is a file.
    const pack = readFileSync(join(from, 'assets.pack'))
    const index = JSON.parse(readFileSync(join(from, 'assets.json'), 'utf8'))
    for (const [name, [offset, size]] of Object.entries(index)) write(`${dir}/game/${name}`, pack.subarray(offset, offset + size))
  }
  return snapshot.games.map((g) => g.id)
}
