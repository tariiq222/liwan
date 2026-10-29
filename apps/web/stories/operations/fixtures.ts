import { OperationProcessSchema, OperationRequestSchema, OperationRequestSummarySchema } from '@webvue/contracts'
import { http, HttpResponse } from 'msw'
import { apiHandlers } from '../handlers/api'
import { me } from '../fixtures/pmo'

export const reviewers = [{ id: 7, user_id: 7, name: 'مريم القحطاني' }, { id: 8, user_id: 8, name: 'عمر العتيبي' }]
export const process = OperationProcessSchema.parse({ purpose: 'work', stage_approval_mode: 'per_stage', id: 3, name: 'اعتماد طلب إداري', description: 'مراجعة الطلب لدى المدير ثم المسؤول المالي.', state: 'published', revision: 2, execution_kind: 'approval', steps: [{ name: 'مراجعة المدير', reviewer_ids: [7], reviewers: [reviewers[0]], ineligible_reviewer_ids: [] }, { name: 'المراجعة المالية', reviewer_ids: [8], reviewers: [reviewers[1]], ineligible_reviewer_ids: [] }] })
export const summary = OperationRequestSummarySchema.parse({ purpose: 'work', id: 12, name: 'اعتماد مستلزمات الفريق', process: { id: process.id, name: process.name }, process_revision: 2, state: 'pending', revision: 3, cycle: 1, requester: { id: 2, user_id: 2, name: 'هند الحربي' }, created_at: '2026-10-14T08:00:00', execution_count: 0 })
export const request = OperationRequestSchema.parse({ ...summary, description: 'مستلزمات تجهيز فريق المشروع.', target: null, steps: [{ sequence: 1, name: 'مراجعة المدير', reviewers: [reviewers[0]], status: 'pending' }, { sequence: 2, name: 'المراجعة المالية', reviewers: [reviewers[1]], status: 'waiting' }], events: [{ id: 1, kind: 'submitted', actor: summary.requester, comment: '', cycle: 1, created_at: summary.created_at }], attachments: [], allowed_actions: { edit: false, submit: false, approve: true, reject: true, return: true, withdraw: false } })
export const draft = OperationRequestSchema.parse({ ...request, state: 'draft', steps: [], events: [], allowed_actions: { edit: true, submit: true, approve: false, reject: false, return: false, withdraw: false } })
export const operationHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['operations.requests.read', 'operations.requests.create', 'operations.requests.review', 'operations.monitoring.read', 'operations.processes.manage'] })),
  // The totals differ by scope and state, as the KPI strip counts them with one-row requests.
  http.get('/api/v1/operations/requests', ({ request }) => {
    const url = new URL(request.url)
    const totals: Record<string, number> = { all: 12, draft: 1, pending: 4, returned: 2, rejected: 1, withdrawn: 0, done: 5 }
    const total = url.searchParams.get('scope') === 'pending' ? 3 : totals[url.searchParams.get('state') ?? 'all']
    return HttpResponse.json({ items: [summary], total })
  }),
  http.get('/api/v1/operations/processes', () => HttpResponse.json({ items: [process], total: 1 })),
  http.get('/api/v1/operations/execution-kinds', () => HttpResponse.json({ items: ['approval', 'pmo_completion'], total: 2 })),
  http.get('/api/v1/operations/processes/:id/targets', () => HttpResponse.json({ items: [{ id: 5, name: 'إعداد خطة المشروع', href: '/projects/1/tasks/5' }], total: 1 })),
  http.get('/api/v1/people', () => HttpResponse.json(reviewers)),
  ...apiHandlers,
]
