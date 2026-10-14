// HR rows for the isolated mock (MODULE_UI_PREVIEW=1). Row 1 of each list is the row the single-row
// preview always served; rows 2+ exist so lists, filters, J/K, an archived scope and a record with
// missing data can be tested. Reads only: the mock has no HR write routes.
const OPS = { id: 1, name: 'إدارة العمليات' }
const PEOPLE = { id: 2, name: 'الموارد البشرية' }
const SARA = { id: 1, name: 'سارة محمد' }
const KHALID = { id: 2, name: 'خالد الشمري' }
const AHMAD = { id: 1, name: 'أحمد العتيبي' }

const employees = [
  { id: 1, name: SARA.name, job_title: 'مديرة العمليات', department: OPS, work_email: 'sara@example.test', work_phone: '+966500000001', user_id: 1, manager: AHMAD, active: true, access: { user_id: 1, login: 'sara', role: 'admin', active: true } },
  { id: 2, name: KHALID.name, job_title: 'محلل موارد بشرية', department: PEOPLE, work_email: 'khalid@example.test', work_phone: '+966500000002', user_id: null, manager: SARA, active: true, access: null },
  { id: 3, name: 'منى القحطاني', job_title: '', department: null, work_email: '', work_phone: '', user_id: null, manager: null, active: true, access: null },
  { id: 4, name: 'ليلى الدوسري', job_title: 'منسقة', department: OPS, work_email: 'laila@example.test', work_phone: '', user_id: 4, manager: SARA, active: false, access: { user_id: 4, login: 'laila', role: 'employee', active: false } },
]
const departments = [
  { id: 1, name: OPS.name, parent_id: null, manager: SARA, child_ids: [3], employee_count: 4 },
  { id: 2, name: PEOPLE.name, parent_id: null, manager: KHALID, child_ids: [], employee_count: 2 },
  { id: 3, name: 'العمليات الميدانية', parent_id: 1, manager: null, child_ids: [], employee_count: 0 },
]
const documents = [
  { id: 1, name: 'دليل إجراءات التشغيل', department: OPS, body: 'يوضح هذا المستند إجراءات التشغيل المعتمدة للفريق.', attachment_ids: [{ id: 1, name: 'دليل التشغيل.pdf', mimetype: 'application/pdf', file_size: 245760 }], write_date: '2026-09-10T08:00:00+03:00' },
  { id: 2, name: 'سياسة الإجازات', department: PEOPLE, body: 'تنظم هذه السياسة الإجازات السنوية والمرضية.', attachment_ids: [], write_date: '2026-09-12T08:00:00+03:00' },
  { id: 3, name: 'نموذج تقييم الأداء', department: PEOPLE, body: 'نموذج التقييم السنوي لأداء الموظفين.', attachment_ids: [], write_date: '2026-09-14T08:00:00+03:00' },
]

const page = (items, url) => {
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return { items: items.slice(offset, offset + (Number.isFinite(limit) && limit > 0 ? limit : 50)), total: items.length }
}
const matches = (name, q) => !q || name.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())
const byId = (rows, path, base) => {
  const id = /^\d+$/.test(path.slice(base.length + 1)) ? Number(path.slice(base.length + 1)) : NaN
  return rows.find(row => row.id === id)
}

export function hrPreviewData(path, url) {
  const route = String(path || '/').replace(/\/+$/, '') || '/'
  const q = url.searchParams.get('q') ?? ''
  const department = Number(url.searchParams.get('department_id') ?? 0)
  if (route === '/api/v1/hr/employees') {
    const archived = ['1', 'true'].includes(url.searchParams.get('archived') ?? '')
    return page(employees.filter(row => row.active !== archived && matches(row.name, q) && (!department || row.department?.id === department)), url)
  }
  if (route.startsWith('/api/v1/hr/employees/')) return byId(employees, route, '/api/v1/hr/employees')
  if (route === '/api/v1/hr/departments') return page(departments, url)
  if (route.startsWith('/api/v1/hr/departments/')) return byId(departments, route, '/api/v1/hr/departments')
  if (route === '/api/v1/hr/documents') return page(documents.filter(row => matches(row.name, q) && (!department || row.department.id === department)), url)
  if (route.startsWith('/api/v1/hr/documents/')) return byId(documents, route, '/api/v1/hr/documents')
  return undefined
}
