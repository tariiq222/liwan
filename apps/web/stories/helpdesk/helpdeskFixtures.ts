import { MeSchema, type CustomerPick, type HelpdeskAttachment, type HelpdeskCategoryResource, type HelpdeskMessage, type HelpdeskReference, type HelpdeskResource, type HelpdeskSlaPolicy, type HelpdeskStageResource, type HelpdeskTeamResource, type HelpdeskTicket, type HelpdeskTicketRow } from '@liwan/contracts'
import { me } from '../fixtures/pmo'

// The wire shapes of the Support Desk stories: the tenant's reference lists, the queue's ticket rows, one ticket with its
// thread, and the rows the settings sections edit. Settings rows include the archived ones; the reference lists that the
// ticket form and the list filters read carry only the active ones, exactly as the server answers them.

/** An agent of the desk: the support application is in the subscription, and the named capabilities are the only ones held. */
export const helpdeskMe = (capabilities: string[]) => MeSchema.parse({
  ...me,
  capabilities,
  home_capabilities: capabilities,
  modules: ['liwan_helpdesk'],
  entitlements: { ...me.entitlements, 'helpdesk.enabled': true },
})

export const teamRows: HelpdeskTeamResource[] = [
  { id: 1, name: 'الدعم التقني', active: true, sequence: 10, member_ids: [{ id: 7, name: 'سارة القحطاني' }, { id: 9, name: 'محمد العتيبي' }], leader_id: 7, calendar_id: null },
  { id: 2, name: 'الصيانة والمرافق', active: true, sequence: 20, member_ids: [{ id: 4, name: 'خالد الحربي' }], leader_id: 4, calendar_id: null },
  { id: 3, name: 'خدمة العملاء', active: false, sequence: 30, member_ids: [{ id: 7, name: 'سارة القحطاني' }], leader_id: 7, calendar_id: null },
]
export const teamRefs = teamRows.filter(team => team.active).map(team => ({ id: team.id, name: team.name }))

export const stageRows: HelpdeskStageResource[] = [
  { id: 11, name: 'جديدة', active: true, sequence: 10, closed: false, unattended: false, fold: false, team_ids: [], shared: false },
  { id: 12, name: 'قيد المعالجة', active: true, sequence: 20, closed: false, unattended: false, fold: false, team_ids: [1], shared: false },
  { id: 13, name: 'بانتظار العميل', active: true, sequence: 30, closed: false, unattended: true, fold: false, team_ids: [], shared: false },
  { id: 14, name: 'مغلقة', active: true, sequence: 40, closed: true, unattended: false, fold: true, team_ids: [], shared: true },
  { id: 15, name: 'مرحلة قديمة', active: false, sequence: 90, closed: false, unattended: false, fold: false, team_ids: [], shared: false },
]
export const stageRefs = stageRows.filter(stage => stage.active).map(stage => ({ id: stage.id, name: stage.name, closed: stage.closed }))

export const categoryRows: HelpdeskCategoryResource[] = [
  { id: 31, name: 'الحساب والدخول', active: true, sequence: 10, parent_id: null },
  { id: 32, name: 'الفوترة', active: true, sequence: 20, parent_id: null },
  { id: 33, name: 'كلمة المرور', active: true, sequence: 11, parent_id: 31 },
  { id: 34, name: 'تصنيف قديم', active: false, sequence: 90, parent_id: null },
]
export const categoryRefs = categoryRows.filter(category => category.active).map(category => ({ id: category.id, name: category.name }))

export const tagRows: HelpdeskResource[] = [
  { id: 61, name: 'تسجيل الدخول', active: true, sequence: 10 },
  { id: 62, name: 'فاتورة', active: true, sequence: 20 },
  { id: 63, name: 'وسم قديم', active: false, sequence: 90 },
]
export const tagRefs = tagRows.filter(tag => tag.active).map(tag => ({ id: tag.id, name: tag.name }))

export const channelRows: HelpdeskResource[] = [
  { id: 51, name: 'البريد الإلكتروني', active: true, sequence: 10 },
  { id: 52, name: 'الهاتف', active: true, sequence: 20 },
  { id: 53, name: 'زيارة ميدانية', active: false, sequence: 30 },
]
export const channelRefs = channelRows.filter(channel => channel.active).map(channel => ({ id: channel.id, name: channel.name }))

export const typeRows: HelpdeskResource[] = [
  { id: 41, name: 'عطل', active: true, sequence: 10 },
  { id: 42, name: 'طلب خدمة', active: true, sequence: 20 },
]
export const typeRefs = typeRows.filter(type => type.active).map(type => ({ id: type.id, name: type.name }))

/** The reference lists the ticket form and the list filters read. */
export const reference: HelpdeskReference = {
  teams: teamRefs,
  stages: stageRefs,
  categories: categoryRefs,
  types: typeRefs,
  channels: channelRefs,
  tags: tagRefs,
}

const refOf = (rows: { id: number, name: string }[], id: number) => {
  const row = rows.find(candidate => candidate.id === id)!
  return { id: row.id, name: row.name }
}
// A ticket keeps the name of the team and stage it was filed in, even after either is archived, so the rows read the
// settings lists rather than the active reference lists. Its stage is the ticket's own three fields, not the settings row.
const teamOf = (id: number) => refOf(teamRows, id)
const stageOf = (id: number): HelpdeskTicketRow['stage'] => {
  const stage = stageRows.find(candidate => candidate.id === id)!
  return { id: stage.id, name: stage.name, closed: stage.closed }
}

const slaOnTrack: HelpdeskTicketRow['sla'] = {
  state: 'on_track',
  deadline: '2026-11-18T09:30:00Z',
  rows: [{ id: 1, name: 'الرد الأول', state: 'in_progress', deadline: '2026-11-18T09:30:00Z', hours: 4 }],
}
const slaDueSoon: HelpdeskTicketRow['sla'] = {
  state: 'due_soon',
  deadline: '2026-11-17T13:10:00Z',
  rows: [{ id: 2, name: 'الرد الأول', state: 'in_progress', deadline: '2026-11-17T13:10:00Z', hours: 4 }],
}
const slaOverdue: HelpdeskTicketRow['sla'] = {
  state: 'overdue',
  deadline: '2026-11-16T08:30:00Z',
  rows: [{ id: 3, name: 'الحل', state: 'expired', deadline: '2026-11-16T08:30:00Z', hours: 24 }],
}
const slaNone: HelpdeskTicketRow['sla'] = { state: 'none', deadline: null, rows: [] }

/** The queue: an overdue urgent ticket, an unassigned new one, a guest from the site and a closed one. */
export const tickets: HelpdeskTicketRow[] = [
  {
    id: 101, number: 'HD00001',
    subject: 'تعذّر تسجيل الدخول إلى بوابة العملاء بعد تغيير كلمة المرور',
    team: teamOf(1), stage: stageOf(12), priority: 'urgent',
    assignee: { id: 7, name: 'سارة القحطاني' },
    requester: { kind: 'customer', id: 21, name: 'مؤسسة النخيل' },
    category: refOf(categoryRefs, 31), type: refOf(typeRefs, 41), channel: refOf(channelRefs, 51),
    tags: [refOf(tagRefs, 61)],
    sla: slaOverdue, created_at: '2026-11-15T06:40:00Z', last_activity_at: '2026-11-17T07:20:00Z',
  },
  {
    id: 102, number: 'HD00002',
    subject: 'طلب إضافة مستخدم جديد إلى مساحة فريق المشتريات',
    team: teamOf(1), stage: stageOf(11), priority: 'medium',
    assignee: null,
    requester: { kind: 'employee', id: 2, name: 'Admin' },
    category: refOf(categoryRefs, 31), type: refOf(typeRefs, 42), channel: refOf(channelRefs, 51),
    tags: [],
    sla: slaOnTrack, created_at: '2026-11-16T09:05:00Z', last_activity_at: '2026-11-16T09:05:00Z',
  },
  {
    id: 103, number: 'HD00003',
    subject: 'تسريب ماء في دورة المياه بالطابق الثاني قرب قاعة الاجتماعات',
    team: teamOf(2), stage: stageOf(13), priority: 'high',
    assignee: { id: 9, name: 'محمد العتيبي' },
    requester: { kind: 'guest', name: 'زائر من الموقع' },
    category: null, type: refOf(typeRefs, 41), channel: refOf(channelRefs, 52),
    tags: [],
    sla: slaDueSoon, created_at: '2026-11-17T05:25:00Z', last_activity_at: '2026-11-17T06:15:00Z',
  },
  {
    id: 104, number: 'HD00004',
    subject: 'فاتورة الاشتراك تظهر بمبلغ مختلف عن العرض المتفق عليه',
    team: teamOf(3), stage: stageOf(12), priority: 'medium',
    assignee: { id: 7, name: 'سارة القحطاني' },
    requester: { kind: 'customer', id: 22, name: 'منى العتيبي' },
    category: refOf(categoryRefs, 32), type: refOf(typeRefs, 42), channel: refOf(channelRefs, 51),
    tags: [refOf(tagRefs, 62)],
    sla: slaOnTrack, created_at: '2026-11-16T11:45:00Z', last_activity_at: '2026-11-17T04:30:00Z',
  },
  {
    id: 105, number: 'HD00005',
    subject: 'استفسار عن مدة توصيل الأثاث المكتبي للفرع الجديد',
    team: teamOf(3), stage: stageOf(14), priority: 'low',
    assignee: { id: 9, name: 'محمد العتيبي' },
    requester: { kind: 'customer', id: 21, name: 'مؤسسة النخيل' },
    category: null, type: null, channel: refOf(channelRefs, 52),
    tags: [],
    sla: slaNone, created_at: '2026-11-10T10:00:00Z', last_activity_at: '2026-11-13T09:20:00Z',
  },
  {
    id: 106, number: 'HD00006',
    subject: 'لوحة التقارير لا تعرض أرقام الأسبوع الماضي بعد تحديث النظام',
    team: teamOf(1), stage: stageOf(11), priority: 'high',
    assignee: null,
    requester: { kind: 'employee', id: 7, name: 'سارة القحطاني' },
    category: refOf(categoryRefs, 31), type: refOf(typeRefs, 41), channel: refOf(channelRefs, 51),
    tags: [],
    sla: slaOnTrack, created_at: '2026-11-17T07:55:00Z', last_activity_at: '2026-11-17T07:55:00Z',
  },
]

/** The customers an agent may open a ticket for. */
export const customerPicks: CustomerPick[] = [
  { id: 21, name: 'مؤسسة النخيل', is_company: true, phone_last4: '4412' },
  { id: 22, name: 'منى العتيبي', is_company: false, phone_last4: null },
]

export const threadMessages: HelpdeskMessage[] = [
  { id: 1, body: '<p>جرّبت إعادة تعيين كلمة المرور مرتين، وتظهر لي رسالة أن الرابط منتهي الصلاحية.</p>', author: 'منى العتيبي', author_id: null, internal: false, created_at: '2026-11-15T06:52:00Z' },
  { id: 2, body: '<p>شكرًا على التفاصيل. أعدت إصدار رابط جديد صالح ٢٤ ساعة وأرسلته إلى البريد المسجّل في الحساب.</p>', author: 'سارة القحطاني', author_id: 7, internal: false, created_at: '2026-11-15T07:30:00Z' },
  { id: 3, body: '<p>تحققت من السجل: الحساب مرتبط ببريد قديم. ننتظر تأكيد العميل بالبريد الجديد قبل تحديث بيانات الحساب.</p>', author: 'محمد العتيبي', author_id: 9, internal: true, created_at: '2026-11-16T09:10:00Z' },
]

export const threadAttachments: HelpdeskAttachment[] = [
  { id: 71, name: 'لقطة-شاشة-الخطأ.png', mimetype: 'image/png', size: 184320, created_at: '2026-11-15T06:55:00Z' },
  { id: 72, name: 'رسالة-الرابط-المنتهي.pdf', mimetype: 'application/pdf', size: 96256, created_at: '2026-11-15T06:58:00Z' },
]

/** The edit page's ticket: the overdue login ticket with its description, first response and attachments. */
export const ticketDetail: HelpdeskTicket = {
  ...tickets[0]!,
  description: '<p>العميل غيّر كلمة المرور من صفحة الحساب، ومنذ ذلك الحين تظهر رسالة أن رابط إعادة التعيين منتهي الصلاحية على كل المتصفحات.</p><p>المطلوب: التحقق من صلاحية رابط إعادة التعيين وتحديث بريد الحساب.</p>',
  related: [{ id: 104, number: 'HD00004', subject: 'فاتورة الاشتراك تظهر بمبلغ مختلف عن العرض المتفق عليه' }],
  first_response: { at: '2026-11-15T07:30:00Z', due: '2026-11-15T10:40:00Z' },
  assigned_at: '2026-11-15T06:45:00Z',
  closed_at: null,
  attachments: threadAttachments,
  portal_link: null,
}

export const slaPolicies: HelpdeskSlaPolicy[] = [
  { id: 81, name: 'الرد الأول خلال أربع ساعات', active: true, days: 0, hours: 4, stage_id: 12, team_ids: [1], category_ids: [], tag_ids: [], ignore_stage_ids: [13], ticket_count: 18 },
  { id: 82, name: 'حلّ أعطال الأنظمة في يوم عمل', active: true, days: 1, hours: 0, stage_id: 14, team_ids: [1, 2], category_ids: [31], tag_ids: [61], ignore_stage_ids: [], ticket_count: 7 },
  { id: 83, name: 'اتفاقية الربع الماضي', active: false, days: 2, hours: 12, stage_id: 14, team_ids: [], category_ids: [], tag_ids: [], ignore_stage_ids: [], ticket_count: 0 },
]
