import { describe, expect, it } from 'vitest'
import { personalCardOrder, movePersonalCard, personalOrderKey } from '../personalOrder'

describe('personal overview order', () => {
  it('drops unknown and duplicate saved cards and appends newly permitted cards', () => {
    expect(personalCardOrder(['leave', 'pay', 'documents'], ['pay', 'removed', 'pay'])).toEqual(['pay', 'leave', 'documents'])
    expect(personalCardOrder(['leave', 'pay'], { pay: 0 })).toEqual(['leave', 'pay'])
  })
  it('moves a card one place without changing the available set or wrapping boundaries', () => {
    expect(movePersonalCard(['leave', 'pay', 'documents'], 'pay', -1)).toEqual(['pay', 'leave', 'documents'])
    expect(movePersonalCard(['leave', 'pay'], 'leave', -1)).toEqual(['leave', 'pay'])
    expect(movePersonalCard(['leave', 'pay'], 'missing', 1)).toEqual(['leave', 'pay'])
  })
  it('isolates preferences between employees and companies and never persists an anonymous key', () => {
    expect(personalOrderKey(1, 7)).not.toBe(personalOrderKey(2, 7))
    expect(personalOrderKey(1, 7)).not.toBe(personalOrderKey(1, 8))
    expect(personalOrderKey(undefined, 7)).toBeNull()
  })
})
