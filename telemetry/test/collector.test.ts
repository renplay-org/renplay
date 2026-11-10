import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { cleanMessage } from '../src/clean'
import schema from '../schema.sql?raw'

const TABLES = ['instances', 'instance_days', 'game_days', 'error_days', 'usage_days', 'rate_limits']
const today = () => new Date().toISOString().slice(0, 10)
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function report(n: number, extra: Record<string, unknown> = {}) {
  return {
    schema: 1,
    instance: uuid(n),
    version: '4.8.0',
    day: today(),
    setup: { arch: 'arm64', install: 'image', auth: 'off', adultInstall: 'blurred', uptimeDays: 12, gamesGB: '1-10', dataGB: '<1' },
    scale: { users: 3, devices: 7, games: 40, renpyGames: 38, htmlGames: 2, catalogGames: 35, localGames: 5, saves: 420, mods: 1 },
    play: {
      sessions: 12,
      minutes: 340,
      devices: { phone: 5, tablet: 1, desktop: 6 },
      browsers: { webkit: 6, blink: 6, gecko: 0 },
      homeScreen: 3,
      loadSeconds: { p50: 4.5, p90: 11 },
      fps: { under30: 1, '30to50': 2, '50up': 9 },
    },
    features: { walkthroughs: 2 },
    catalog: [
      { game: 'charm-studies', release: '1.5.5', installed: 1, installs: { ok: 1, failed: 0, seconds: 48, engine: '8.5.3' }, plays: { sessions: 2, minutes: 40 }, errors: 0 },
    ],
    errors: [],
    ...extra,
  }
}

const send = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  exports.default.fetch('https://telemetry.renplay.org/v1/report', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })

const all = async (table: string) => (await env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()).results
const usage = async () => Object.fromEntries((await all('usage_days')).map((r) => [r.key, r.value]))

beforeEach(async () => {
  await env.DB.batch(
    schema
      .split(/;\s*\n/)
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter(Boolean)
      .map((s) => env.DB.prepare(s)),
  )
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
})

describe('a good report', () => {
  it('is answered with 204 and counted', async () => {
    const res = await send(report(1))
    expect(res.status).toBe(204)

    expect(await all('instances')).toEqual([
      { id: uuid(1), first_day: today(), last_day: today(), version: '4.8.0', arch: 'arm64', install: 'image', auth: 'off', adult_install: 'blurred', games_gb: '1-10', data_gb: '<1' },
    ])
    expect(await all('instance_days')).toEqual([{ day: today(), id: uuid(1), version: '4.8.0' }])
    expect(await all('game_days')).toEqual([
      { day: today(), game: 'charm-studies', release: '1.5.5', installed: 1, installs_ok: 1, installs_failed: 0, install_seconds: 48, plays_sessions: 2, plays_minutes: 40, errors: 0 },
    ])
    const u = await usage()
    expect(u).toMatchObject({
      'scale.users': 3,
      'scale.saves': 420,
      'play.sessions': 12,
      'play.devices.phone': 5,
      'play.browsers.webkit': 6,
      'play.fps.30to50': 2,
      'features.walkthroughs': 2,
      'play.loadSeconds.p50': 4.5,
      'play.loadSeconds.p90': 11,
      'play.loadSeconds.count': 1,
    })
    expect(u).not.toHaveProperty('play.browsers.gecko')
  })

  it('is not kept as a report', async () => {
    await send(report(1))
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'").all<{ name: string }>()).results
    expect(tables.map((t) => t.name).sort()).toEqual([...TABLES].sort())
  })

  it('counts a second report of the same instance and day once', async () => {
    expect((await send(report(1))).status).toBe(204)
    expect((await send(report(1))).status).toBe(204)
    expect((await all('instance_days')).length).toBe(1)
    expect((await all('game_days'))[0]).toMatchObject({ plays_sessions: 2 })
    expect((await usage())['scale.users']).toBe(3)
  })

  it('keeps the first day and moves the rest of an instance forward', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
    await send(report(1, { day: day(-1) }))
    await send(report(1, { day: day(0), version: '4.9.0', setup: { arch: 'x64' } }))
    expect(await all('instances')).toMatchObject([{ first_day: day(-1), last_day: day(0), version: '4.9.0', arch: 'x64', install: null }])
    expect((await all('instance_days')).length).toBe(2)
  })

  it('sums two instances on the same day into one game row with no instance id', async () => {
    await send(report(1))
    await send(
      report(2, {
        catalog: [
          { game: 'charm-studies', release: '1.5.5', installed: 1, installs: { ok: 0, failed: 1, seconds: 12 }, plays: { sessions: 3, minutes: 20 }, errors: 2 },
          { game: 'other-game', installed: 1 },
        ],
      }),
    )
    const rows = await all('game_days')
    expect(rows.length).toBe(2)
    expect(rows.find((r) => r.game === 'charm-studies')).toEqual({
      day: today(),
      game: 'charm-studies',
      release: '1.5.5',
      installed: 2,
      installs_ok: 1,
      installs_failed: 1,
      install_seconds: 60,
      plays_sessions: 5,
      plays_minutes: 60,
      errors: 2,
    })
    expect(rows.find((r) => r.game === 'other-game')).toMatchObject({ release: '', installed: 1 })
    for (const table of ['game_days', 'error_days', 'usage_days']) {
      for (const row of await all(table)) expect(Object.keys(row)).not.toContain('id')
    }
    const u = await usage()
    expect(u['scale.users']).toBe(6)
    expect(u['play.loadSeconds.count']).toBe(2)
    expect((await all('instances')).length).toBe(2)
  })

  it('treats missing counts as zero and ignores unknown fields', async () => {
    const res = await send({ schema: 1, instance: uuid(3), version: '4.8.0', day: today(), surprise: { x: 1 }, scale: { users: 1, unknown: 9 } })
    expect(res.status).toBe(204)
    expect(await usage()).toEqual({ 'scale.users': 1 })
    expect(await all('game_days')).toEqual([])
  })
})

describe('a bad report', () => {
  const bad = async (body: unknown, headers?: Record<string, string>) => {
    const res = await send(body, headers)
    expect(res.status).toBe(400)
    expect((await res.text()).length).toBeLessThan(120)
    for (const table of TABLES) expect(await all(table)).toEqual([])
  }

  it('is refused with 400 and nothing is written', async () => {
    await bad('{nope')
    await bad([])
    await bad(report(1, { schema: 2 }))
    await bad(report(1, { instance: 'not-a-uuid' }))
    await bad(report(1, { version: '4.8' }))
    await bad(report(1, { day: '2020-01-01' }))
    await bad(report(1, { day: '2026-13-45' }))
    await bad(report(1, { setup: { arch: 'riscv' } }))
    await bad(report(1, { scale: { users: -1 } }))
    await bad(report(1, { scale: { users: 'many' } }))
    await bad(report(1, { scale: { users: 1.5 } }))
    await bad(report(1, { catalog: [{ game: 'Not An Id' }] }))
    await bad(report(1, { catalog: [{ game: 'x'.repeat(81) }] }))
    await bad(report(1, { errors: [{ game: 'a', kind: 'weird', message: 'x' }] }))
    await bad(report(1, { errors: [{ game: 'a/b', kind: 'sync', message: 'x' }] }))
  })

  it('is refused when it has too many entries', async () => {
    await bad(report(1, { catalog: Array.from({ length: 501 }, (_, i) => ({ game: `g-${i}` })) }))
    await bad(report(1, { errors: Array.from({ length: 51 }, () => ({ game: 'a', kind: 'sync', message: 'x' })) }))
    const full = await send(report(1, { catalog: Array.from({ length: 500 }, (_, i) => ({ game: `g-${i}`, installed: 1 })) }))
    expect(full.status).toBe(204)
    expect((await all('game_days')).length).toBe(500)
  })

  it('is refused when it is too large or not JSON', async () => {
    await bad(JSON.stringify(report(1, { padding: 'x'.repeat(70_000) })))
    await bad(JSON.stringify(report(1)), { 'content-type': 'text/plain' })
  })
})

describe('the rate limit', () => {
  it('allows 3 reports from an instance in 20 hours and answers 429 after', async () => {
    for (let i = 0; i < 3; i++) expect((await send(report(1))).status).toBe(204)
    expect((await send(report(1))).status).toBe(429)
    expect((await send(report(2))).status).toBe(204)
  })

  it('lets an instance report again after 20 hours', async () => {
    const old = Date.now() - 21 * 3_600_000
    await env.DB.batch([1, 2, 3].map(() => env.DB.prepare('INSERT INTO rate_limits (instance, at) VALUES (?1, ?2)').bind(uuid(1), old)))
    expect((await send(report(1))).status).toBe(204)
  })
})

describe('messages', () => {
  const error = (message: string, extra = {}) => ({ game: 'charm-studies', kind: 'runtime', message, count: 2, ...extra })

  it('with a path or a URL are cleaned before they are kept', async () => {
    const res = await send(
      report(1, {
        errors: [
          error("FileNotFoundError: /home/jan/games/x/game/a.rpy line 12\nTraceback: C:\\Users\\jan\\x.rpy"),
          error('Cannot fetch https://my-server.example.com/g/42?token=abc from 192.168.1.20 for jan@example.com'),
          error('KeyError: "secret name" and \'another\' and `third`'),
          error('Save 1234567890 is broken, slot 12 too'),
        ],
      }),
    )
    expect(res.status).toBe(204)
    const messages = (await all('error_days')).map((r) => r.message).sort()
    expect(messages).toEqual([
      'Cannot fetch <x> from <x> for <x>',
      'FileNotFoundError: <x> line 12',
      'KeyError: <x> and <x> and <x>',
      'Save <x> is broken, slot 12 too',
    ])
    const text = JSON.stringify(await all('error_days'))
    for (const leak of ['/home', 'jan', 'example', 'secret', '192.168', 'Users', 'Traceback']) expect(text).not.toContain(leak)
  })

  it('are summed per day, game and kind', async () => {
    await send(report(1, { errors: [error('Boom')] }))
    await send(report(2, { errors: [error('Boom', { count: 3 }), error('Boom', { kind: 'sync' })] }))
    const rows = await all('error_days')
    expect(rows.find((r) => r.kind === 'runtime')).toMatchObject({ count: 5, game: 'charm-studies', message: 'Boom' })
    expect(rows.length).toBe(2)
  })

  it('cleanMessage keeps the first line and 200 characters', () => {
    expect(cleanMessage('AttributeError: module has no attribute\nsecond line')).toBe('AttributeError: module has no attribute')
    expect(cleanMessage("It doesn't work and it can't")).toBe("It doesn't work and it can't")
    expect(cleanMessage('x'.repeat(500)).length).toBe(200)
    expect(cleanMessage('\n')).toBe('')
  })
})

describe('what is kept', () => {
  it('never holds the IP address or any header', async () => {
    const ip = '203.0.113.77'
    const res = await send(report(1), {
      'content-type': 'application/json',
      'user-agent': 'Renplay/4.8.0 (+https://renplay.org)',
      'cf-connecting-ip': ip,
      'x-forwarded-for': ip,
      'x-real-ip': ip,
      authorization: 'Bearer secret-token',
    })
    expect(res.status).toBe(204)
    for (const table of TABLES) {
      const dump = JSON.stringify(await all(table))
      expect(dump).not.toContain(ip)
      expect(dump).not.toContain('Renplay/4.8.0')
      expect(dump).not.toContain('secret-token')
    }
    const columns = (await env.DB.prepare("SELECT m.name AS tbl, p.name AS col FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '\\_%' ESCAPE '\\'").all<{ tbl: string; col: string }>()).results
    expect(columns.filter((c) => /ip|addr|agent|header|forward/i.test(c.col))).toEqual([])
  })
})

describe('the other routes', () => {
  it('answer GET / in one line with a link to the docs', async () => {
    const res = await exports.default.fetch('https://telemetry.renplay.org/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const body = await res.text()
    expect(body.trim().split('\n').length).toBe(1)
    expect(body).toContain('https://docs.renplay.org/telemetry/')
  })

  it('answer everything else with 404', async () => {
    for (const [method, path] of [['GET', '/v1/report'], ['POST', '/'], ['GET', '/v1'], ['GET', '/admin'], ['DELETE', '/v1/report']]) {
      expect((await exports.default.fetch(`https://telemetry.renplay.org${path}`, { method })).status).toBe(404)
    }
  })
})

describe('the daily cron', () => {
  it('deletes rows older than 400 days and old rate limit rows, and keeps the rest', async () => {
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
    await env.DB.batch([
      env.DB.prepare('INSERT INTO instances (id, first_day, last_day, version) VALUES (?1, ?2, ?2, ?3)').bind(uuid(1), day(450), '4.0.0'),
      env.DB.prepare('INSERT INTO instances (id, first_day, last_day, version) VALUES (?1, ?2, ?3, ?4)').bind(uuid(2), day(450), day(1), '4.0.0'),
      ...[450, 399].flatMap((ago) => [
        env.DB.prepare('INSERT INTO instance_days (day, id, version) VALUES (?1, ?2, ?3)').bind(day(ago), uuid(2), '4.0.0'),
        env.DB.prepare('INSERT INTO game_days (day, game, "release") VALUES (?1, ?2, ?3)').bind(day(ago), 'g', ''),
        env.DB.prepare('INSERT INTO error_days (day, game, kind, message) VALUES (?1, ?2, ?3, ?4)').bind(day(ago), 'g', 'sync', 'm'),
        env.DB.prepare('INSERT INTO usage_days (day, key, value) VALUES (?1, ?2, 1)').bind(day(ago), 'scale.users'),
      ]),
      env.DB.prepare('INSERT INTO rate_limits (instance, at) VALUES (?1, ?2)').bind(uuid(1), Date.now() - 30 * 3_600_000),
      env.DB.prepare('INSERT INTO rate_limits (instance, at) VALUES (?1, ?2)').bind(uuid(2), Date.now() - 3_600_000),
    ])

    await worker.scheduled({} as ScheduledController, env)

    expect((await all('instances')).map((r) => r.id)).toEqual([uuid(2)])
    for (const table of ['instance_days', 'game_days', 'error_days', 'usage_days']) {
      expect((await all(table)).map((r) => r.day)).toEqual([day(399)])
    }
    expect((await all('rate_limits')).map((r) => r.instance)).toEqual([uuid(2)])
  })
})
