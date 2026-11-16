import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEMO_DESCRIPTION, DEMO_TITLE, ROBOTS_TXT, demoHead } from '../../../demo/static/seo.mjs'

const library = readFileSync(new URL('../../../selector/index.html', import.meta.url), 'utf8')

describe('what search engines read at the static demo', () => {
  it('lets crawlers in, since a blocked page never shows its noindex', () => {
    const lines = ROBOTS_TXT.split('\n').map((line) => line.trim().toLowerCase())
    expect(lines).toContain('user-agent: *')
    expect(lines).toContain('allow: /')
    expect(lines.filter((line) => /^disallow:\s*\S/.test(line))).toEqual([])
  })
  it('gives the library page the demo\'s own title and description, and a noindex', () => {
    const page = demoHead(library)
    expect(page).toContain(`<title>${DEMO_TITLE}</title>`)
    expect(page).not.toContain('<title>Renplay</title>')
    expect(page).toContain(`<meta name="description" content="${DEMO_DESCRIPTION}" />`)
    expect(page).toContain('<meta name="robots" content="noindex" />')
    expect(page).toContain('<div id="root"></div>')
  })
  it('refuses a page that has no title to replace', () => {
    expect(() => demoHead('<html><head></head></html>')).toThrow()
  })
})
