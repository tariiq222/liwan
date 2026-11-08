/** The part of `document` the helper reads, so a test can pass a stand-in. */
interface DescriptionScope {
  querySelectorAll: (selector: string) => Iterable<Element>
  getElementById: (id: string) => Element | null
}

/**
 * Reka marks an open tooltip trigger with `aria-describedby` pointing at its hidden `role="tooltip"` copy. A trigger that
 * already carries an `aria-label` has its name from that label, and the tooltip repeats it, so screen readers would read
 * the name twice. This drops the description from such triggers; a trigger without an `aria-label` keeps it.
 */
export function dropDuplicatedDescription(scope: DescriptionScope): void {
  for (const trigger of scope.querySelectorAll('[data-grace-area-trigger][aria-describedby][aria-label]')) {
    const described = scope.getElementById(trigger.getAttribute('aria-describedby') ?? '')
    if (described?.getAttribute('role') === 'tooltip') trigger.removeAttribute('aria-describedby')
  }
}
