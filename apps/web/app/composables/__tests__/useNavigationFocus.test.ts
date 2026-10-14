import { afterEach, describe, expect, it } from 'vitest'
import { clearNavigationFocus, offerNavigationFocus, takeNavigationFocus } from '../useNavigationFocus'

const element = (isConnected = true) => ({ isConnected }) as unknown as HTMLElement

afterEach(() => clearNavigationFocus())

describe('navigation focus hand-off', () => {
  it('hands the offered element over once', () => {
    const trigger = element()
    offerNavigationFocus(() => trigger)
    expect(takeNavigationFocus()).toBe(trigger)
    expect(takeNavigationFocus()).toBeNull()
  })

  it('resolves the target when it is taken, not when it is offered', () => {
    let current: HTMLElement | null = null
    offerNavigationFocus(() => current)
    current = element()
    expect(takeNavigationFocus()).toBe(current)
  })

  it('never hands over a disconnected element', () => {
    offerNavigationFocus(() => element(false))
    expect(takeNavigationFocus()).toBeNull()
  })

  it('drops an offer that is cleared before anyone takes it', () => {
    offerNavigationFocus(() => element())
    clearNavigationFocus()
    expect(takeNavigationFocus()).toBeNull()
  })
})
