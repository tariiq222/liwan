import { describe, expect, it } from 'vitest'
import {
  ADMIN_PAGE_SIZE,
  adminListQuery,
  adminPathWithQuery,
  adminQueryWithOffset,
  parseAdminOffset,
} from '../adminSettingsPaths'

describe('admin settings pagination and return paths', () => {
  it('normalizes invalid and unaligned offsets to a valid page boundary', () => {
    expect(ADMIN_PAGE_SIZE).toBe(25)
    expect(parseAdminOffset(undefined)).toBe(0)
    expect(parseAdminOffset('bad')).toBe(0)
    expect(parseAdminOffset('-25')).toBe(0)
    expect(parseAdminOffset('13')).toBe(0)
    expect(parseAdminOffset('26')).toBe(25)
    expect(parseAdminOffset('50')).toBe(50)
  })

  it('preserves supported list filters while validating the page offset', () => {
    expect(adminListQuery({ q: ' Sara ', status: 'active', role_id: '4', offset: '26', ignored: 'x' }, ['q', 'status', 'role_id', 'offset']))
      .toEqual({ q: ' Sara ', status: 'active', role_id: '4', offset: '25' })
    expect(adminQueryWithOffset({ q: 'Sara', offset: '25' }, 0)).toEqual({ q: 'Sara' })
    expect(adminQueryWithOffset({ q: 'Sara', offset: '25' }, 50)).toEqual({ q: 'Sara', offset: '50' })
  })

  it('builds an internal path with encoded return filters', () => {
    expect(adminPathWithQuery('/settings/users/12', { q: 'Sara A', offset: '25' }))
      .toBe('/settings/users/12?q=Sara+A&offset=25')
  })
})
