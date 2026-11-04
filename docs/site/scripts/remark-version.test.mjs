import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import remarkVersion from './remark-version.mjs'

const { version } = JSON.parse(readFileSync(new URL('../../../server/package.json', import.meta.url), 'utf8'))

test('remark-version replaces image tags in prose, inline code and fenced code', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [
        { type: 'text', value: 'Pin __RENPLAY_VERSION__.' },
        { type: 'inlineCode', value: 'renplay/renplay:__RENPLAY_VERSION__' },
      ] },
      { type: 'code', lang: 'yaml', value: 'image: ghcr.io/renplay-org/renplay:__RENPLAY_VERSION__' },
      { type: 'code', lang: 'sh', value: 'docker logs renplay' },
    ],
  }
  remarkVersion()(tree)
  assert.equal(tree.children[0].children[0].value, `Pin ${version}.`)
  assert.equal(tree.children[0].children[1].value, `renplay/renplay:${version}`)
  assert.equal(tree.children[1].value, `image: ghcr.io/renplay-org/renplay:${version}`)
  assert.equal(tree.children[2].value, 'docker logs renplay')
})
