// The collector for Renplay's daily usage report. It never reads the IP address or any request header
// except content-type and content-length, and never keeps a report: see README.md and schema.sql.
import { limited, purge, write } from './store'
import { MAX_BODY, check } from './validate'

interface Env {
  DB: D1Database
}

const DOCS = 'https://docs.renplay.org/telemetry/'
const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/** The body, or null as soon as it is over the limit, whatever the content-length said. */
async function read(request: Request): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = []
  let size = 0
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength
      if (size > MAX_BODY) return null
      chunks.push(chunk)
    }
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return all
}

async function report(request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return text('The report must be JSON.\n', 400)
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY) return text('The report is too large.\n', 400)

  const raw = await read(request)
  if (!raw) return text('The report is too large.\n', 400)
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch {
    return text('The report is not valid JSON.\n', 400)
  }

  const now = Date.now()
  const checked = check(body, new Date(now).toISOString().slice(0, 10))
  if (!checked.ok) return text(`${checked.reason}.\n`, 400)

  if (await limited(env.DB, checked.report.instance, now)) return text('Too many reports from this instance.\n', 429)
  await write(env.DB, checked.report, now)
  return new Response(null, { status: 204 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/v1/report' && request.method === 'POST') return report(request, env)
    if (pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      return text(`This receives the daily usage report of Renplay instances. What it keeps is on ${DOCS}\n`)
    }
    return text('Not found.\n', 404)
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await purge(env.DB, Date.now())
  },
} satisfies ExportedHandler<Env>
