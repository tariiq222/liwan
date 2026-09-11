import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const pagesRoot = resolve(appRoot, 'pages')

const hrRouteFiles = [
  'hr/index.vue',
  'hr/employees/new.vue',
  'hr/employees/[employeeId].vue',
  'hr/employees/[employeeId]/edit.vue',
  'hr/employees/[employeeId]/access.vue',
  'hr/departments/index.vue',
  'hr/departments/new.vue',
  'hr/departments/[departmentId].vue',
  'hr/departments/[departmentId]/edit.vue',
  'hr/documents/index.vue',
  'hr/departments/[departmentId]/documents/new.vue',
  'hr/departments/[departmentId]/documents/[documentId].vue',
  'hr/departments/[departmentId]/documents/[documentId]/edit.vue',
]

const capabilityGatedFiles = [
  'components/hr/DirectoryTable.vue',
  'components/hr/EmployeeGeneralForm.vue',
  'components/hr/EmployeeCard.vue',
  'components/hr/DepartmentTable.vue',
  'components/hr/DocumentList.vue',
]

describe('routed HR pages', () => {
  it('ships each employee, department, and document route from the HR pillar', () => {
    for (const route of hrRouteFiles) {
      expect(existsSync(resolve(pagesRoot, route)), route).toBe(true)
    }
  })
})

describe('HR capability boundaries', () => {
  it('uses the shared useAccess capability source for HR visibility and writes', () => {
    let sources = ''
    for (const relative of capabilityGatedFiles) {
      const source = readFileSync(resolve(appRoot, relative), 'utf8')
      expect(source, relative).toMatch(/useAccess/)
      expect(source, relative).not.toMatch(/\.value\?\.role|role\s*===/)
      sources += source
    }
    expect(sources).toMatch(/hr\.employees\.access_status\.read/)
    expect(sources).toMatch(/hr\.employees\.manage/)
    expect(sources).toMatch(/hr\.employees\.archive/)
    expect(sources).toMatch(/hr\.departments\.manage/)
    expect(sources).toMatch(/hr\.documents\.manage/)
  })

  it('does not retain a legacy HR access editor or write endpoint client', () => {
    const source = readFileSync(resolve(appRoot, 'composables/useHrEmployees.ts'), 'utf8')
    expect(source).not.toMatch(/useGrantHrAccess|useUpdateHrAccess|useRevokeHrAccess/)
    expect(source).not.toMatch(/\/access/)
  })

  it('redirects the legacy HR access page into system account administration', () => {
    const path = resolve(pagesRoot, 'hr/employees/[employeeId]/access.vue')
    expect(existsSync(path), 'missing legacy HR access redirect route').toBe(true)
    if (!existsSync(path)) return
    const source = readFileSync(path, 'utf8')
    expect(source).toMatch(/navigateTo/)
    expect(source).toMatch(/settings\/users/)
    expect(source).not.toMatch(/useGrantHrAccess|useUpdateHrAccess|useRevokeHrAccess|method:\s*['"](POST|PATCH|DELETE)/)
  })
})
