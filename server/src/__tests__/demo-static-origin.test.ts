import { describe, expect, it } from 'vitest'
import { fromElsewhere } from '../../../demo/static/sw/origin'

/*
 * The stand-in answers a page's requests, and also a top-level navigation into the demo, which another site can
 * start with a form. A change from such a request must be refused, the way the server's csrf() refuses it
 * (accounts/accounts.ts): by Origin and Fetch Metadata where the browser gives them to the worker, and by the kind of
 * request where it does not.
 */

const HERE = 'https://demo.test'
const ask = (method: string, headers: Record<string, string> = {}, more: { mode?: string; referrer?: string } = {}) =>
  fromElsewhere({ method, mode: more.mode ?? 'cors', referrer: more.referrer ?? 'about:client', headers: new Headers(headers) }, HERE)

describe('a change that comes from another site', () => {
  it('is refused by its Origin', () => {
    expect(ask('POST', { origin: 'https://evil.test' })).toBe(true)
    expect(ask('POST', { origin: 'null' })).toBe(true)
    expect(ask('DELETE', { origin: 'http://demo.test' })).toBe(true)
  })
  it('is refused by its Fetch Metadata, whatever its Origin says', () => {
    expect(ask('PUT', { 'sec-fetch-site': 'cross-site' })).toBe(true)
    expect(ask('PUT', { 'sec-fetch-site': 'same-site', origin: HERE })).toBe(true)
    expect(ask('PUT', { 'sec-fetch-site': 'cross-site', origin: HERE })).toBe(true)
  })
  it('is refused when it is a navigation, which no page of the demo makes with a change', () => {
    expect(ask('POST', {}, { mode: 'navigate' })).toBe(true)
    expect(ask('POST', { origin: HERE }, { mode: 'navigate' })).toBe(true)
  })
  it('is refused by the page it was sent from', () => {
    expect(ask('POST', {}, { referrer: 'https://evil.test/page' })).toBe(true)
  })

  it('is allowed from the demo itself', () => {
    expect(ask('POST', { origin: HERE })).toBe(false)
    expect(ask('PUT', { 'sec-fetch-site': 'same-origin' })).toBe(false)
    expect(ask('POST', { 'sec-fetch-site': 'same-origin', origin: HERE }, { referrer: `${HERE}/game/the-question` })).toBe(false)
    expect(ask('PUT', {})).toBe(false)
  })
  it('is not a change when it only reads', () => {
    expect(ask('GET', { origin: 'https://evil.test' })).toBe(false)
    expect(ask('HEAD', {}, { mode: 'navigate' })).toBe(false)
    expect(ask('OPTIONS', { origin: 'https://evil.test' })).toBe(false)
  })
})
