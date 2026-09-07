/**
 * Explicit-submit forms stay protected until the successful submit has
 * completed. Keeping the comparison here makes the submitted transition
 * testable without mounting a router guard in Vitest.
 */
export function isDirtySnapshot(baseline: string, current: string, submitted: boolean): boolean {
  return !submitted && baseline !== current
}
