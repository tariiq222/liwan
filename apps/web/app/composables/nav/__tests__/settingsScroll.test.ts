import { describe, expect, it } from 'vitest'
import { anchorOf, cardsInBand, isSamePageAnchor, createSelectionHold, createSpy, isAtBottom, isSpyHash, liveHash, readingCard, rememberSpyHash, whenElement, effectiveActivePart, hashScrollPosition, partFromHash, topmostVisible } from '../settingsScroll'

const card = (path: string, id: string) => ({ to: { path, hash: `#${id}` } })
const company = [{ to: '/settings/company' }, card('/settings/company', 'profile'), card('/settings/company', 'contact'), card('/settings/company', 'branding')]

describe('the selection hold', () => {
  it('keeps a chosen card selected however long the scroll takes, until the reader takes over', () => {
    const hold = createSelectionHold()
    expect(hold.held).toBe(false)
    hold.hold()
    // Any number of spy updates while the page scrolls slowly, or cannot scroll the card to the top, change nothing.
    for (let update = 0; update < 100; update += 1) expect(hold.held).toBe(true)
    hold.release()
    expect(hold.held).toBe(false)
  })
})

describe('settings scroll helpers', () => {
  it('reads the card a link scrolls to, and none for a link that opens a page', () => {
    expect(anchorOf(card('/settings/company', 'contact'))).toBe('contact')
    expect(anchorOf({ to: '/settings/team/users' })).toBeNull()
    expect(anchorOf({ to: { path: '/settings/company' } })).toBeNull()
  })

  it('tells a link to a card of the open page from a link that changes the route', () => {
    expect(isSamePageAnchor(card('/settings/company', 'contact'), '/settings/company')).toBe(true)
    expect(isSamePageAnchor(card('/settings/company', 'contact'), '/settings/system')).toBe(false)
    expect(isSamePageAnchor({ to: '/settings/company' }, '/settings/company')).toBe(false)
  })

  it('marks the spy card, else the hash card, else the first card of the open page', () => {
    expect(effectiveActivePart('/settings/company', company, 'contact', '')).toBe('contact')
    expect(effectiveActivePart('/settings/company', company, null, '#branding')).toBe('branding')
    expect(effectiveActivePart('/settings/company', company, null, '')).toBe('profile')
    // A card of another page left in the shared state, or an unknown hash, never wins.
    expect(effectiveActivePart('/settings/company', company, 'maintenance', '#nope')).toBe('profile')
    expect(effectiveActivePart('/settings/system', company, 'contact', '')).toBeNull()
  })

  it('picks the topmost card among the visible ones, in page order', () => {
    const order = ['profile', 'address', 'contact']
    expect(topmostVisible(order, new Set(['contact', 'address']))).toBe('address')
    expect(topmostVisible(order, new Set())).toBeNull()
  })

  it('accepts a hash only when it names one of the page cards', () => {
    expect(partFromHash('#contact', ['profile', 'contact'])).toBe('contact')
    expect(partFromHash('#nope', ['profile', 'contact'])).toBeNull()
    expect(partFromHash('#%E0%A4%A', ['profile'])).toBeNull()
    expect(partFromHash('', ['profile'])).toBeNull()
  })

  it('scrolls smoothly below the header, instantly on a first load and not at all smoothly for reduced motion', () => {
    const el = {} as Element
    expect(hashScrollPosition(el, 88, 'smooth', false)).toEqual({ el, top: 88, behavior: 'smooth' })
    expect(hashScrollPosition(el, 88, 'smooth', true)).toEqual({ el, top: 88, behavior: 'auto' })
    expect(hashScrollPosition(el, 88, 'instant', false)).toEqual({ el, top: 88, behavior: 'instant' })
  })
})

describe('the spy decisions', () => {
  const order = ['profile', 'address', 'contact', 'branding']
  function spy() {
    const state = { active: null as string | null, selected: [] as string[] }
    const controller = createSpy({
      active: () => state.active,
      setActive: id => { state.active = id },
      select: id => { state.active = id; state.selected.push(id) },
    })
    return { state, controller }
  }

  it('lands on the first card, or on the card the hash names and keeps it', () => {
    const first = spy()
    first.controller.land(order, '')
    expect(first.state.active).toBe('profile')
    expect(first.controller.held).toBe(false)
    const named = spy()
    named.controller.land(order, '#contact')
    expect(named.state.active).toBe('contact')
    expect(named.controller.held).toBe(true)
  })

  it('lands once, and only when the cards are known', () => {
    const { state, controller } = spy()
    controller.land([], '#contact')
    expect(state.active).toBeNull()
    controller.land(order, '#contact')
    controller.land(order, '#branding')
    expect(state.active).toBe('contact')
  })

  it('does not move the mark while a chosen card is held, and follows the reader once they take over', () => {
    const { state, controller } = spy()
    controller.land(order, '#branding')
    controller.reading(order, new Set(['address']), false, order)
    expect(state.active).toBe('branding')
    controller.takeover()
    controller.reading(order, new Set(['address', 'contact']), false, order)
    expect(state.selected).toEqual(['address'])
  })

  it('holds the card of a click, and of a hash that arrives by navigation, until the reader scrolls', () => {
    const { state, controller } = spy()
    controller.clicked('contact')
    expect(state.selected).toEqual(['contact'])
    controller.reading(order, new Set(['profile']), false, order)
    expect(state.active).toBe('contact')
    controller.takeover()
    controller.navigated(order, '#address')
    expect(state.active).toBe('address')
    expect(controller.held).toBe(true)
    controller.navigated(order, '#nope')
    expect(state.active).toBe('address')
  })

  it('marks the last card once the page is scrolled to its end, where the band can no longer reach it', () => {
    const { state, controller } = spy()
    controller.reading(order, new Set(['contact']), true, order)
    expect(state.active).toBe('branding')
    expect(readingCard(order, new Set(['profile']), false)).toBe('profile')
    expect(readingCard(order, new Set(), true, ['profile', 'address'])).toBe('address')
  })

  it('knows the end of the page, and a page with nothing to scroll has none', () => {
    expect(isAtBottom(1000, 800, 1800)).toBe(true)
    expect(isAtBottom(998, 800, 1800)).toBe(true)
    expect(isAtBottom(500, 800, 1800)).toBe(false)
    expect(isAtBottom(0, 800, 800)).toBe(false)
  })
})

describe('the hash the spy writes', () => {
  it('is recognised by the router and read live by the filters', () => {
    expect(isSpyHash('#address')).toBe(false)
    rememberSpyHash('#address')
    expect(isSpyHash('#address')).toBe(true)
    expect(isSpyHash('#contact')).toBe(false)
    expect(isSpyHash('')).toBe(false)
    expect(liveHash('#profile', '#address')).toBe('#address')
    expect(liveHash('#profile', undefined)).toBe('#profile')
  })

  it('waits a bounded number of frames for a card that renders late', async () => {
    let frames = 0
    const frame = async () => { frames += 1 }
    expect(await whenElement(() => (frames >= 3 ? 'card' : null), frame)).toBe('card')
    frames = 0
    expect(await whenElement(() => null, frame, 5)).toBeNull()
    expect(frames).toBe(5)
  })
})

describe('the reading card from the current geometry', () => {
  const order = ['profile', 'address', 'contact', 'branding']
  const rects = (tops: number[]) => order.map((id, index) => ({ id, top: tops[index]!, bottom: tops[index]! + 300 }))
  const reader = () => {
    const state = { active: null as string | null }
    const spy = createSpy({ active: () => state.active, setActive: id => { state.active = id }, select: id => { state.active = id } })
    const read = (tops: number[], scrollY: number) => spy.reading(order, cardsInBand(rects(tops), 88, 360), isAtBottom(scrollY, 800, 1800), order)
    return { state, read }
  }

  it('keeps cards that cross the band and drops those above the header or below the band', () => {
    expect(cardsInBand(rects([-400, 100, 420, 740]), 88, 360)).toEqual(new Set(['address']))
    expect(cardsInBand(rects([-200, 100, 420, 740]), 88, 360)).toEqual(new Set(['profile', 'address']))
  })

  it('reads the first card at the top of a page whose first card starts below the band, and the last passed card in a gap', () => {
    expect(cardsInBand(rects([425, 1290, 1891, 2279]), 88, 360)).toEqual(new Set(['profile']))
    expect(cardsInBand([{ id: 'profile', top: -500, bottom: 60 }, { id: 'address', top: 500, bottom: 900 }], 88, 360)).toEqual(new Set(['profile']))
  })

  it('goes from the last card at the bottom of the page back to the first at the top, however the scroll got there', () => {
    const { state, read } = reader()
    read([-1700, -1300, -900, 1400], 1000)
    expect(state.active).toBe('branding')
    read([425, 1290, 1891, 2279], 0)
    expect(state.active).toBe('profile')
  })
})
