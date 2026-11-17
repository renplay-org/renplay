import { describe, expect, it } from 'vitest'
import { headersFor } from '../../../demo/static/headers.mjs'
import { demoFrameAncestors } from '../shared/demo-embed.js'

/** The _headers file of Cloudflare's static assets: a path, then its headers indented under it. */
function rules(file: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let path = ''
  for (const line of file.split('\n')) {
    if (/^\S/.test(line)) out[(path = line.trim())] = {}
    else if (line.trim()) out[path]![line.slice(0, line.indexOf(':')).trim()] = line.slice(line.indexOf(':') + 1).trim()
  }
  return out
}

describe('the static demo headers', () => {
  it('frame the demo by itself and the website only, with the policy of the server demo', () => {
    const all = rules(headersFor('https://renplay.org'))['/*']!
    expect(all['Content-Security-Policy']).toBe(demoFrameAncestors(true, 'https://renplay.org'))
    expect(all['X-Content-Type-Options']).toBe('nosniff')
  })
  it('say noindex on every answer, so that crawlers that are let in leave the demo out of their results', () => {
    expect(rules(headersFor('https://renplay.org'))['/*']!['X-Robots-Tag']).toBe('noindex')
  })
  it('check the page and the worker each time and keep what is named by its content for good', () => {
    const file = rules(headersFor('https://renplay.org'))
    for (const path of ['/index.html', '/sw.js', '/demo/*']) expect(file[path]).toEqual({ 'Cache-Control': 'no-cache' })
    for (const path of ['/assets/*', '/api/art/*']) expect(file[path]).toEqual({ 'Cache-Control': 'public, max-age=31536000, immutable' })
  })
  it('take one exact origin, as the server does', () => {
    expect(headersFor('http://localhost:5190')).toContain("frame-ancestors 'self' http://localhost:5190")
    for (const value of ['https://*.renplay.org', 'https://renplay.org/', 'https://renplay.org/path', 'https://user@renplay.org', 'https://renplay.org https://evil.test', 'https://renplay.org; script-src *', 'data:text/html,test', '*']) expect(() => headersFor(value), value).toThrow()
  })
})
