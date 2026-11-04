import { describe, expect, it } from 'vitest'
import { aimsAtMenu } from '../menuAim'

// RTL shell: the rail is on the right, the menu opens to its left.
const menu = { left: 1120, right: 1350, top: 420, bottom: 890 }

describe('aimsAtMenu', () => {
  it('a diagonal toward the lower part of the menu aims at it', () => {
    expect(aimsAtMenu({ x: 1390, y: 476 }, { x: 1384, y: 486 }, menu)).toBe(true)
  })

  it('straight down the rail does not aim at the menu', () => {
    expect(aimsAtMenu({ x: 1390, y: 476 }, { x: 1390, y: 500 }, menu)).toBe(false)
  })

  it('moving away from the menu does not aim at it', () => {
    expect(aimsAtMenu({ x: 1390, y: 476 }, { x: 1400, y: 486 }, menu)).toBe(false)
  })

  it('heading past the menu bottom does not aim at it', () => {
    expect(aimsAtMenu({ x: 1390, y: 870 }, { x: 1385, y: 900 }, menu)).toBe(false)
  })

  it('works when the menu opens to the right (LTR)', () => {
    const ltr = { left: 90, right: 320, top: 420, bottom: 890 }
    expect(aimsAtMenu({ x: 50, y: 476 }, { x: 56, y: 486 }, ltr)).toBe(true)
    expect(aimsAtMenu({ x: 50, y: 476 }, { x: 50, y: 500 }, ltr)).toBe(false)
  })
})
