import { describe, expect, it, vi } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'
import { focusFormField as focus } from '../../../../utils/formErrors'

type Root = Parameters<typeof focus>[0]
const focusFormField = (root: unknown, name: string) => focus(root as Root, name)
const modules = { '../../../utils/formErrors': { focusFormField: focus } }
const errors = [{ field: 'amounts', message: 'Fix the amounts' }, { field: 'reason', message: 'Give a reason' }]

describe('SharedErrorSummary', () => {
  it('renders nothing while the form has no mistakes', async () => {
    expect(await renderShared('ErrorSummary', { title: 'Fix these', errors: [] }, {}, { modules })).not.toContain('error-summary')
  })

  it('renders nothing, and does not throw, when errors is omitted', async () => {
    expect(await renderShared('ErrorSummary', { title: 'Fix these' }, {}, { modules })).not.toContain('error-summary')
  })

  it('names the heading and links every mistake to its field, in the order given', async () => {
    const html = await renderShared('ErrorSummary', { title: 'Fix these', errors }, {}, { modules })
    expect(html).toContain('tabindex="-1"')
    expect(html).toMatch(/<h2[^>]*>Fix these<\/h2>/)
    expect(html).toMatch(/aria-labelledby="(error-summary-[^"]*)"/)
    expect(html.indexOf('href="#field-amounts"')).toBeLessThan(html.indexOf('href="#field-reason"'))
    expect(html).toContain('Fix the amounts')
  })
})

describe('focusFormField', () => {
  const control = (invalid: boolean) => ({ focus: vi.fn(), scrollIntoView: vi.fn(), invalid })
  const rootOf = (name: string, invalid: ReturnType<typeof control> | null, first: ReturnType<typeof control> | null) => ({
    querySelector: (selector: string) => selector === `[data-field="${name}"]`
      ? { querySelector: (inner: string) => (inner.includes('aria-invalid') ? invalid : first) }
      : null,
  })

  it('focuses the first invalid control of the field', () => {
    const bad = control(true); const first = control(false)
    expect(focusFormField(rootOf('amounts', bad, first), 'amounts')).toBe(true)
    expect(bad.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(bad.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(first.focus).not.toHaveBeenCalled()
  })

  it('falls back to the first control, and reports a missing field', () => {
    const first = control(false)
    expect(focusFormField(rootOf('amounts', null, first), 'amounts')).toBe(true)
    expect(first.focus).toHaveBeenCalled()
    expect(focusFormField(rootOf('amounts', null, first), 'other')).toBe(false)
  })
})
