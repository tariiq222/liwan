import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { documentEntryRedirect } from '../entryRedirect'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: {} }] })
const redirect = (path: string) => documentEntryRedirect(router.resolve(path))
describe('legacy document entry navigation', () => {
  it('preserves committed list filters and hash while mapping department context', () => {
    expect(redirect('/hr/documents?q=policy&department_id=7&offset=25#files')).toEqual({ path: '/documents', query: { q: 'policy', context_kind: 'hr.department', context_id: '7', offset: '25' }, hash: '#files' })
  })
  it('keeps document identity on direct record/edit links and maps an internal list return', () => {
    expect(redirect('/hr/departments/7/documents/91/edit?returnTo=%2Fhr%2Fdocuments%3Fq%3Dpolicy%23list#body')).toEqual({ path: '/documents/91/edit', query: { returnTo: '/documents?q=policy#list' }, hash: '#body' })
  })
  it('preselects a department for a create entry and drops external returns', () => {
    expect(redirect('/hr/departments/7/documents/new?returnTo=https://evil.test')).toEqual({ path: '/documents/new', query: { context_kind: 'hr.department', context_id: '7' }, hash: '' })
  })
  it.each(['/hr/departments/0/documents/1', '/hr/departments/7/documents/nope', '/hr/documents/1', '/documents/91'])('does not turn malformed or canonical paths into a document: %s', path => expect(redirect(path)).toBeNull())
})

import { canReachPath } from '../../../utils/accessPolicy'
it('requires document capabilities even for system administrators and hides write routes from readers', () => {
  const platform = { readable_features: ['documents.enabled'], writable_features: ['documents.enabled'] }
  expect(canReachPath({ role: 'system_admin', capabilities: ['access.users.read'], platform }, '/documents')).toBe(false)
  const reader = { capabilities: ['documents.items.read'], platform }
  expect(canReachPath(reader, '/documents/8')).toBe(true)
  for (const path of ['/documents/new', '/documents/8/edit', '/documents/8/access']) expect(canReachPath(reader, path)).toBe(false)
})
