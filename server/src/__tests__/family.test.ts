import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDir } from '../pipeline/archive.js'
import { detectEngine, nameFromFile } from '../pipeline/family.js'

/** Detects the engine of a folder made of these files. */
async function detect(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-family-'))
  for (const [p, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), data)
  }
  const src = await openDir(root)
  try {
    return await detectEngine(src.entries)
  } finally {
    src.close()
  }
}

/** A Godot pack header: magic, pack format, engine version, flags. */
function pck(format: number, [major, minor, patch]: number[], flags = 0): Buffer {
  const b = Buffer.alloc(64)
  b.write('GDPC', 0, 'latin1')
  ;[format, major!, minor!, patch!, flags].forEach((v, i) => b.writeUInt32LE(v, 4 + i * 4))
  return b
}

describe('engine detection', () => {
  it('finds Ren’Py games first, even with pages and libraries of their own', async () => {
    const e = await detect({ 'Game-1.0-pc/game/script.rpyc': 'x', 'Game-1.0-pc/game/manual/index.html': '<title>Manual</title>', 'Game-1.0-pc/lib/py3-windows-x86_64/python.dll': 'x' })
    expect(e).toMatchObject({ family: 'renpy', root: 'Game-1.0-pc/', installable: true })
  })

  it('reads Twine stories, Twine 2 and Twine 1 style', async () => {
    const tw2 = await detect({ 'Story/index.html': '<html><tw-storydata name="My Story" format="Harlowe" format-version="3.3.9" ifid="x"></tw-storydata></html>' })
    expect(tw2).toMatchObject({ family: 'html', kind: 'twine-harlowe', version: '3.3.9', label: 'Harlowe 3.3.9 (Twine)', title: 'My Story', root: 'Story/', entry: 'index.html' })
    const sc = await detect({
      'College/College.html': '<title>main_file</title><div id="store-area" data-size="2" hidden><div tiddler="StoryTitle" tags="">College Daze</div></div><script>version:{title:"SugarCube",major:2,minor:36,patch:1}</script>',
      'College/images/a.mp4': 'x',
    })
    expect(sc).toMatchObject({ family: 'html', kind: 'twine-sugarcube', version: '2.36.1', title: 'College Daze', entry: 'College.html' })
  })

  it('reads RPG Maker MV and MZ versions', async () => {
    const mz = await detect({ 'Game/index.html': '<title>Quest</title>', 'Game/js/rmmz_core.js': 'Utils.RPGMAKER_VERSION = "1.8.0";' })
    expect(mz).toMatchObject({ family: 'html', kind: 'rpgmaker-mz', version: '1.8.0', label: 'RPG Maker MZ 1.8.0', root: 'Game/' })
    const mv = await detect({ 'Game/Game.exe': 'x', 'Game/www/index.html': '', 'Game/www/js/rpg_core.js': "Utils.RPGMAKER_VERSION = '1.6.1';" })
    expect(mv).toMatchObject({ kind: 'rpgmaker-mv', version: '1.6.1', root: 'Game/www/' })
  })

  it('reads the Godot version from the pack and warns about native plugins', async () => {
    const e = await detect({ 'Game.exe': 'x', 'Game.pck': pck(3, [4, 6, 2], 2), 'phone_core.windows.x86_64.dll': 'x' })
    expect(e).toMatchObject({ family: 'godot', version: '4.6.2', label: 'Godot 4.6.2', entry: 'Game.pck', title: 'Game' })
    expect(e!.warnings[0]).toContain('phone_core.windows.x86_64.dll')
    const encrypted = await detect({ 'Game.pck': pck(2, [4, 2, 0], 1) })
    expect(encrypted).toMatchObject({ family: 'godot', installable: false })
    expect(encrypted!.reason).toContain('encrypted')
  })

  it('makes names readable', () => {
    expect(nameFromFile('Sexting_sim_stories_V0.17.0-release-free')).toBe('Sexting sim stories')
    expect(nameFromFile('My Game')).toBe('My Game')
    expect(nameFromFile('Game-v1.2')).toBe('Game')
  })

  it('tells Unity WebGL builds from PC builds', async () => {
    const webgl = await detect({ 'Game/index.html': '', 'Game/Build/Game.loader.js': '', 'Game/Build/Game.data.br': '' })
    expect(webgl).toMatchObject({ family: 'unity', kind: 'unity-webgl', root: 'Game/' })
    const pc = await detect({ 'Phone.exe': 'x', 'UnityPlayer.dll': 'x', 'Phone_Data/globalgamemanagers': Buffer.concat([Buffer.alloc(20), Buffer.from('6000.6.0f1\0', 'latin1')]) })
    expect(pc).toMatchObject({ family: 'unity', kind: 'unity-desktop', version: '6000.6.0f1', title: 'Phone', installable: false })
  })

  it('names engines that only make PC programs, and gives up on the rest', async () => {
    expect(await detect({ 'Game/Game.exe': 'x', 'Game/Game.rgss3a': 'x', 'Game/Game.ini': '' })).toMatchObject({ family: 'rpgmaker-rgss', installable: false })
    expect(await detect({ 'Game/Data.wolf': 'x' })).toMatchObject({ family: 'wolf' })
    expect(await detect({ 'game.swf': 'x' })).toMatchObject({ family: 'flash', installable: false })
    expect(await detect({ 'readme.txt': 'x' })).toBeNull()
  })
})
