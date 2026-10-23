import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Plan 6d pages stay on their templates. A source guard, not a behaviour test: behaviour is pinned by
// e2e/tasmim6-*.spec.ts.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the Plan 6d pages stay on their templates', () => {
  it.each([
    ['pages/settings/team/users/index.vue', ['<SharedListPage', 'data-testid="settings-layout"']],
    ['pages/settings/team/roles/index.vue', ['<SharedListPage', 'data-testid="settings-layout"']],
    ['pages/settings/team/access-log/index.vue', ['<SharedListPage', 'data-testid="settings-layout"']],
    ['pages/notifications.vue', ['<SharedListPage', 'useRowNavigation']],
  ])('%s is a list page', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
    expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
  })

  it.each([
    'pages/settings/team/roles/[roleId]/index.vue', 'pages/settings/team/users/[userId]/index.vue',
    'pages/settings/team/access-log/[eventId].vue', 'pages/notification-digests/[id].vue', 'pages/search.vue',
  ])('%s is a record page', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedRecordPage')
    expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
    expect(source, 'no hand-made card').not.toMatch(/rounded-lg ring ring-default bg-default overflow-hidden/)
  })

  it.each([
    'pages/settings/company/index.vue', 'pages/settings/system/index.vue', 'pages/settings/team/users/[userId]/access.vue',
    'pages/settings/team/users/[userId]/security.vue', 'pages/settings/team/roles/[roleId]/edit.vue', 'pages/account/settings.vue',
  ])('%s stays on the settings template', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedSettingsPage')
    expect(source, 'no hand-made card').not.toMatch(/rounded-lg ring ring-default bg-default overflow-hidden/)
  })

  it.each(['pages/login.vue', 'pages/invite/accept.vue', 'error.vue'])('%s is a standalone card', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedStandalonePage')
    expect(source).not.toContain('<main')
  })

  it.each([
    'components/access/users/UserTable.vue', 'components/access/roles/RoleTable.vue', 'components/access/audit/AuditTable.vue',
  ])('%s renders through SharedDataTable', (file) => {
    const source = read(file)
    expect(source).toContain('<SharedDataTable')
    expect(source).not.toContain('<UTable')
    expect(source).toContain('#mobile-row')
  })

  it('no Plan 6d page or component keeps a scoped style or a hand-made card', () => {
    for (const file of [
      'pages/account/settings.vue', 'pages/login.vue', 'pages/notifications.vue', 'pages/search.vue',
      'components/access/users/UserSecurityForm.vue', 'components/access/users/UserTable.vue',
    ]) {
      const source = read(file)
      expect(source, file).not.toContain('<style')
      expect(source, file).not.toMatch(/<UCard[^>]*rounded-lg ring ring-default bg-default overflow-hidden/)
    }
  })
})
describe('the access form sections', () => {
  it('security delegates its panel and title to the approved form section', () => {
    const source = read('components/access/users/UserSecurityForm.vue')
    expect(source).toContain('<SharedFormSection panel')
    expect(source).toContain(":title=\"t('access.users.securityTitle')\"")
    expect(source).not.toContain('<UCard')
  })
})
