/** One line of the form's error summary: the field it names (the `name` of the field component) and what is wrong. */
export interface ErrorSummaryItem { field: string, message: string }

/** What a field is made of; an invalid one is preferred when the field holds several (a list of amounts). */
const CONTROLS = 'input, textarea, select, [role="combobox"], button'

interface Queryable { querySelector: (selector: string) => Element | null }

/**
 * Moves focus to the first invalid control of the field `name` inside `root`, or to its first control when none is
 * marked invalid. Answers whether it found one. The scroll is instant, so it respects reduced motion.
 */
export function focusFormField(root: Queryable, name: string): boolean {
  const field = root.querySelector(`[data-field="${name.replace(/["\\]/g, '\\$&')}"]`)
  const control = (field?.querySelector('[aria-invalid="true"]') ?? field?.querySelector(CONTROLS)) as HTMLElement | null | undefined
  if (!control) return false
  control.focus({ preventScroll: true })
  control.scrollIntoView({ block: 'center' })
  return true
}
