import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROGRESSIVE_RULES } from '../pipeline/project.js'
import { compileMatch, makePlaceholder, parseRules, streamsImage } from '../pipeline/progressive.js'

describe('progressive download rules', () => {
  it('matches like Ren\'Py distribute.match', () => {
    expect(compileMatch('game/gui/**').test('game/gui/button/idle.png')).toBe(true)
    expect(compileMatch('game/*.png').test('game/a.png')).toBe(true)
    expect(compileMatch('game/*.png').test('game/x/a.png')).toBe(false)
    expect(compileMatch('GAME/**').test('game/Images/A.PNG')).toBe(true)
    expect(compileMatch('game/[ab].png').test('game/b.png')).toBe(true)
  })

  it('streams everything but the GUI by default', () => {
    const rules = parseRules(DEFAULT_PROGRESSIVE_RULES)
    expect(streamsImage('game/images/week 1/w1_1.png', rules)).toBe(true)
    expect(streamsImage('game/gui/main_menu.png', rules)).toBe(false)
    expect(streamsImage('game/images/x.webm', rules)).toBe(false)
  })

  it('makes 1/32 placeholders with the original size recorded', async () => {
    const img = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#808080' } }).png().toBuffer()
    const ph = await makePlaceholder(img)
    expect(ph).toMatchObject({ width: 1920, height: 1080 })
    expect(await sharp(ph!.png).metadata()).toMatchObject({ width: 60, height: 33, format: 'png' })
  })
})
