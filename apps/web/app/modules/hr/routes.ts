/** The four fixed sections of the HR sidebar, plus the caller's own services (custody, payslips). */
export type HrSection = 'hiring' | 'people' | 'time' | 'pay' | 'mine'

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** The section a path opens; the directory, departments, employee records and anything else under /hr belong to people. */
export function hrSectionOf(path: string | undefined): HrSection {
  const pathname = path?.split(/[?#]/, 1)[0] ?? ''
  if (pathname === '/hr/assets/mine' || under(pathname, '/hr/payroll/mine')) return 'mine'
  if (under(pathname, '/hr/recruitment')) return 'hiring'
  if (under(pathname, '/hr/leave') || under(pathname, '/hr/shifts')) return 'time'
  if (under(pathname, '/hr/payroll')) return 'pay'
  return 'people'
}

const SECTION_TARGET = '/hr/sections/'

/** The key a section link carries in `within`: it names a section, not a page, and is read by `hrNavActive`. */
export function hrSectionTarget(section: HrSection): string {
  return `${SECTION_TARGET}${section}`
}

/** Whether `target` is a section key and, when it is, whether `path` lies in that section. */
export function hrSectionActive(path: string, target: string): boolean | undefined {
  return target.startsWith(SECTION_TARGET) ? hrSectionOf(path) === target.slice(SECTION_TARGET.length) : undefined
}
