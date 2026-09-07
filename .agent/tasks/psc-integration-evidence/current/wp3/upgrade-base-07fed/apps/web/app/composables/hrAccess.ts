import type { HrEmployee } from '@nasq/contracts'

export function hrAccessLabelKey(employee: Pick<HrEmployee, 'access'>): string {
  const access = employee.access
  if (!access) return 'hr.directory.access.noAccount'
  if (!access.active) return 'hr.directory.access.stopped'
  return `hr.directory.access.${access.role}`
}
