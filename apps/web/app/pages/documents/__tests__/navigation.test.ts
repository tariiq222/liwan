import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { employeeDocumentBack, documentRecordBack, documentChildTo, documentParentTo } from '../../../lib/documentNavigation'
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: {} }] })
it('returns a legacy department entry to its safe record and keeps the origin through edit cycles', () => {
  const origin = '/hr/departments/7?returnTo=%2Fhr%2Fdepartments%3Fview%3Dtree%23chart'
  let query = { returnTo: origin }
  for (let cycle = 0; cycle < 3; cycle++) {
    expect(router.resolve(documentRecordBack(query)).fullPath).toBe(origin)
    const edit = router.resolve(documentChildTo('/documents/8/edit', query))
    const record = router.resolve(documentParentTo('/documents/8', edit.query))
    query = record.query as typeof query
  }
})
it('drops external, duplicate and unrelated return destinations and strips recursive library origins', () => {
  for (const returnTo of ['https://evil.test', '//evil.test', '/settings/team/users', ['/documents', '/documents']]) expect(router.resolve(documentRecordBack({ returnTo } as never)).path).toBe('/documents')
  expect(router.resolve(documentRecordBack({ returnTo: '/documents?q=policy&returnTo=%2Fsettings#list' })).fullPath).toBe('/documents?q=policy#list')
})

it('keeps personal detail back links within the own list and preserves its pagination', () => {
  expect(router.resolve(employeeDocumentBack({ returnTo: '/account/documents?offset=25#files' })).fullPath).toBe('/account/documents?offset=25#files')
  for (const returnTo of ['/documents?offset=25', '/hr/7', '/account/documents/9', 'https://evil.test']) {
    expect(router.resolve(employeeDocumentBack({ returnTo })).fullPath).toBe('/account/documents')
  }
})
