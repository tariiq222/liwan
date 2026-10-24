import { expect, type Locator } from '@playwright/test'

export async function expectAlignedGuide(parent: Locator) {
  const geometry = await parent.evaluate(el => {
    const icon = el.querySelector('.webvue-quick-chip')!.getBoundingClientRect()
    const row = el.getBoundingClientRect()
    const connector = getComputedStyle(el, '::after')
    const body = el.parentElement!.querySelector<HTMLElement>('.webvue-navigation-submenu')!
    const rect = body.getBoundingClientRect()
    const style = getComputedStyle(body)
    const guide = getComputedStyle(body, '::before')
    const pseudo = guide.content !== 'none' && guide.content !== 'normal'
    const width = pseudo ? parseFloat(guide.width) : parseFloat(style.borderInlineStartWidth)
    const inset = pseudo ? parseFloat(guide.insetInlineStart) : 0
    const center = (icon.left + icon.right) / 2
    const children = [...body.querySelectorAll('.webvue-quick-chip')].filter(child => child.closest('.webvue-navigation-submenu') === body).map(child => child.getBoundingClientRect())
    const firstCenter = (children[0]!.left + children[0]!.right) / 2
    const selected = [...body.querySelectorAll('.webvue-quick-link[data-active="true"] .webvue-quick-chip')].find(child => child.closest('.webvue-navigation-submenu') === body)
    const selectedRect = selected?.getBoundingClientRect()
    const dot = selected ? getComputedStyle(selected, '::before') : null
    const dotInset = dot ? parseFloat(dot.insetInlineStart) + parseFloat(dot.width) / 2 : 0
    return {
      center,
      guideCenter: style.direction === 'rtl' ? rect.right - inset - width / 2 : rect.left + inset + width / 2,
      guideTop: row.top + parseFloat(connector.top),
      connectorCenter: style.direction === 'rtl' ? row.right - parseFloat(connector.insetInlineStart) - parseFloat(connector.width) / 2 : row.left + parseFloat(connector.insetInlineStart) + parseFloat(connector.width) / 2,
      connectorGap: rect.top + parseFloat(guide.top) - (row.bottom - parseFloat(connector.bottom)),
      guideBottom: rect.bottom - (pseudo ? parseFloat(guide.bottom) : 0),
      iconTop: icon.top, iconBottom: icon.bottom, lastChildBottom: children.at(-1)!.bottom,
      childIndent: Math.abs(center - firstCenter),
      dotCenter: selectedRect ? style.direction === 'rtl' ? selectedRect.right - dotInset : selectedRect.left + dotInset : null,
    }
  })
  expect(Math.abs(geometry.guideCenter - geometry.center), 'guide must align with the parent icon centre').toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.connectorCenter - geometry.center), 'connector must align with the parent icon centre').toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.connectorGap), 'parent connector and child guide must meet').toBeLessThanOrEqual(1)
  expect(geometry.guideTop).toBeLessThanOrEqual(geometry.iconBottom)
  expect(geometry.guideTop).toBeGreaterThanOrEqual(geometry.iconTop)
  expect(geometry.guideBottom).toBeGreaterThanOrEqual(geometry.lastChildBottom)
  expect(geometry.childIndent).toBeCloseTo(20, 0)
  if (geometry.dotCenter !== null) expect(Math.abs(geometry.dotCenter - geometry.guideCenter), 'selected dot must sit on the guide').toBeLessThanOrEqual(1)
}
