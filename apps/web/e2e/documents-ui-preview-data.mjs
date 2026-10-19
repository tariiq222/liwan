// Isolated read-only preview data for the Documents application.
const detail = (id, name, contextId) => ({
  id, name, visibility: 'company', active: true, expiry_date: null, write_date: '2026-10-19T08:00:00+03:00', revision: 1,
  context: { kind: 'hr.department', id: contextId, label: contextId === 1 ? 'إدارة العمليات' : 'الموارد البشرية', href: `/hr/departments/${contextId}` },
  file_count: 0, tags: [], body: '<p>محتوى المستند</p>',
  allowed_actions: { update: true, archive: true, restore: false, upload_file: true, manage_access: true },
})
const daysFromToday = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const documents = [
  { ...detail(1, 'دليل إجراءات التشغيل', 1), visibility: 'restricted', expiry_date: daysFromToday(10) },
  { ...detail(2, 'سياسة الإجازات', 2), expiry_date: daysFromToday(-3) },
  detail(3, 'نموذج تقييم الأداء', 2),
  { ...detail(4, 'سياسة السفر القديمة', 1), active: false },
]
function matchesListFilters(item, params) {
  if (params.get('visibility') && item.visibility !== params.get('visibility')) return false
  if (params.get('expiring_within') && !(item.expiry_date && item.expiry_date <= daysFromToday(Number(params.get('expiring_within'))))) return false
  if (['1', 'true'].includes(params.get('expired') ?? '') && !(item.expiry_date && item.expiry_date < daysFromToday(0))) return false
  return true
}
export function documentsPreviewData(path, url) {
  if (path === '/api/v1/documents/contexts') return { items: [{ kind: 'hr.department', label: 'القسم' }], total: 1 }
  if (path === '/api/v1/documents/contexts/hr.department/options') return { items: [{ id: 1, name: 'إدارة العمليات' }, { id: 2, name: 'الموارد البشرية' }], total: 2 }
  if (path === '/api/v1/documents/tags') return { items: [], total: 0 }
  if (path === '/api/v1/documents') {
    const archived = ['1', 'true'].includes(url.searchParams.get('archived') ?? '')
    const selected = documents.filter(item => item.active !== archived && item.name.includes(url.searchParams.get('q') ?? '') && (!url.searchParams.get('context_id') || item.context.id === Number(url.searchParams.get('context_id'))) && matchesListFilters(item, url.searchParams))
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 50)
    return { items: selected.slice(offset, offset + limit).map(({ body, ...summary }) => summary), total: selected.length }
  }
  if (/^\/api\/v1\/documents\/[1-9]\d*\/files$/.test(path)) return { items: [], total: 0, revision: 1 }
  const match = path.match(/^\/api\/v1\/documents\/([1-9]\d*)$/)
  return match ? documents.find(item => item.id === Number(match[1])) : undefined
}
