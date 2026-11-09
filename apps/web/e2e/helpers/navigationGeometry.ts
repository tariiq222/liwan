import { expect, type Locator } from '@playwright/test'

/**
 * A sidebar branch row (a button with `aria-expanded`) opens `.liwan-side-branch` right under it. The branch's
 * inline-start border is the guide line: it must sit on the centre of the parent's icon, span the whole branch,
 * and the child icons must be indented past the parent icon.
 */
export async function expectAlignedGuide(parent: Locator) {
  const geometry = await parent.evaluate(el => {
    const branch = el.nextElementSibling as HTMLElement
    const rtl = getComputedStyle(branch).direction === 'rtl'
    const icon = el.querySelector('[data-slot="icon"]')!.getBoundingClientRect()
    const rect = branch.getBoundingClientRect()
    const width = parseFloat(getComputedStyle(branch).borderInlineStartWidth)
    const children = [...branch.querySelectorAll(':scope > .liwan-side-row [data-slot="icon"]')].map(child => child.getBoundingClientRect())
    const first = children[0]!
    return {
      isBranch: branch.classList.contains('liwan-side-branch'),
      width,
      iconCenter: (icon.left + icon.right) / 2,
      guideCenter: rtl ? rect.right - width / 2 : rect.left + width / 2,
      branchTop: rect.top,
      parentBottom: el.getBoundingClientRect().bottom,
      lastChildBottom: Math.max(...children.map(child => child.bottom)),
      branchBottom: rect.bottom,
      indent: rtl ? icon.right - first.right : first.left - icon.left,
    }
  })
  expect(geometry.isBranch, 'the branch must follow its parent row').toBe(true)
  expect(geometry.width).toBe(1)
  expect(Math.abs(geometry.guideCenter - geometry.iconCenter), 'guide must align with the parent icon centre').toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.branchTop - geometry.parentBottom), 'branch must start under the parent row').toBeLessThanOrEqual(4)
  expect(geometry.branchBottom).toBeGreaterThanOrEqual(geometry.lastChildBottom)
  expect(geometry.indent, 'child icons are indented past the parent icon').toBeGreaterThan(8)
}
