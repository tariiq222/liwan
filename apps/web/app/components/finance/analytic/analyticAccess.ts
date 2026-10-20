type Can = (capability: string) => boolean

/**
 * Who may write a plan, exactly as the server decides: every plan write needs `finance.analytic.manage`, and a root plan
 * (one with no parent) also needs `finance.setup.manage` because it adds a column to the analytic tables.
 */
export function canWritePlan(can: Can, isRoot: boolean): boolean {
  return can('finance.analytic.manage') && (!isRoot || can('finance.setup.manage'))
}

/** A new plan is a sub-plan when it names a parent; without `finance.setup.manage` a parent is required. */
export function mustChooseParent(can: Can): boolean {
  return !can('finance.setup.manage')
}
