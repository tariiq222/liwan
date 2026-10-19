import type { DocumentAccess, DocumentDetail, DocumentFile } from '@webvue/contracts'
import { http, HttpResponse } from 'msw'
import { me } from '../fixtures/pmo'
export const document: DocumentDetail = {
  id: 8, name: 'سياسة إدارة المستندات', body: '<h2>إدارة المستندات</h2><p>توضح هذه السياسة طريقة حفظ الملفات ومشاركتها داخل المؤسسة.</p>',
  visibility: 'restricted', active: true, expiry_date: '2027-10-19', write_date: '2026-10-19T08:00:00+03:00', revision: 3,
  context: { kind: 'hr.department', id: 1, label: 'إدارة العمليات', href: '/hr/departments/1' }, tags: [{ id: 1, name: 'السياسات' }], file_count: 1,
  allowed_actions: { update: true, archive: true, restore: false, upload_file: true, manage_access: true },

}
export const files: DocumentFile[] = [
    { id: 7, name: 'سياسة المستندات.pdf', mimetype: 'application/pdf', file_size: 245760, active: true, is_locked: false, is_lock_editor: false, download_url: '/api/v1/documents/8/files/7/download', allowed_actions: { archive: true, restore: false, lock: true, unlock: false } },
    { id: 9, name: 'نسخة سابقة.pdf', mimetype: 'application/pdf', file_size: 12000, active: false, is_locked: false, is_lock_editor: false, download_url: '/api/v1/documents/8/files/9/download', allowed_actions: { archive: false, restore: true, lock: false, unlock: false } },
  ]
export const access: DocumentAccess = { revision: 3, visibility: 'restricted', grants: [{ user: { id: 1, name: 'سارة القحطاني' }, access: 'editor' }, { user: { id: 2, name: 'خالد الحربي' }, access: 'reader' }] }
export const documentHandlers = [
  http.get('/api/v1/documents/8/files', () => HttpResponse.json({ items: files, total: files.length, revision: document.revision })),
  http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: [...me.capabilities, 'documents.items.read', 'documents.items.manage', 'documents.items.archive', 'documents.access.manage', 'documents.library.manage', 'hr.departments.read'], entitlements: { ...me.entitlements, 'documents.enabled': true, 'hr.enabled': true } })),
  http.get('/api/v1/documents/contexts', () => HttpResponse.json({ items: [{ kind: 'hr.department', label: 'القسم' }], total: 1 })),
  http.get('/api/v1/documents/contexts/hr.department/options', () => HttpResponse.json({ items: [{ id: 1, name: 'إدارة العمليات' }, { id: 2, name: 'الموارد البشرية' }], total: 2 })),
  http.get('/api/v1/documents/tags', () => HttpResponse.json({ items: document.tags, total: 1 })),
  http.post('/api/v1/documents/tags', async ({ request }) => HttpResponse.json({ id: 2, name: ((await request.json()) as { name: string }).name })),
  http.post('/api/v1/documents', async ({ request }) => HttpResponse.json({ ...document, ...(await request.json() as object), id: 10, revision: 1, visibility: 'restricted', file_count: 0 }, { status: 201 })),
]
