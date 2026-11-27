// Isolated read-only preview data for the three opt-in staff surfaces (`mock_caps=ops_desk`):
// Operations, Support Desk (Helpdesk), and Appointments. Shapes follow @liwan/contracts strictly.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const PEOPLE = {
  ahmad: { id: 1, name: 'أحمد العتيبي', user_id: 1 },
  noura: { id: 2, name: 'نورة الحربي', user_id: 2 },
  khalid: { id: 3, name: 'خالد الشمري', user_id: 3 },
  sara: { id: 4, name: 'سارة القحطاني', user_id: 4 },
  fahad: { id: 5, name: 'فهد الدوسري', user_id: 5 },
}

const paginate = (rows, url, defaultLimit = 20) => {
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const rawLimit = Number(url.searchParams.get('limit') ?? defaultLimit)
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit
  return { items: rows.slice(offset, offset + limit), total: rows.length }
}

const OPERATION_PROCESSES = [
  {
    id: 1,
    name: 'اعتماد المشتريات والعقود',
    description: 'مراجعة واعتماد طلبات الشراء وعقود الموردين قبل التعميد.',
    purpose: 'work',
    stage_approval_mode: 'per_stage',
    state: 'published',
    revision: 2,
    execution_kind: 'manual',
    steps: [
      {
        name: 'مراجعة مدير الإدارة',
        reviewer_ids: [PEOPLE.noura.id],
        reviewers: [PEOPLE.noura],
        ineligible_reviewer_ids: [],
        resolver: null,
        resolver_label: null,
      },
      {
        name: 'اعتماد الشؤون المالية',
        reviewer_ids: [PEOPLE.khalid.id],
        reviewers: [PEOPLE.khalid],
        ineligible_reviewer_ids: [],
        resolver: null,
        resolver_label: null,
      },
    ],
  },
  {
    id: 2,
    name: 'طلب صلاحية وتجهيز بيئة عمل',
    description: 'توفير صلاحيات الأنظمة الداخلية والأجهزة للمشاريع والفرق.',
    purpose: 'work',
    stage_approval_mode: 'single',
    state: 'published',
    revision: 1,
    execution_kind: 'manual',
    steps: [
      {
        name: 'موافقة أمن المعلومات',
        reviewer_ids: [PEOPLE.sara.id],
        reviewers: [PEOPLE.sara],
        ineligible_reviewer_ids: [],
        resolver: null,
        resolver_label: null,
      },
    ],
  },
]

const OPERATION_REQUESTS = [
  {
    id: 101,
    name: 'طلب تعميد شراء وتوريد أجهزة حاسب محمولة وشاشات مكتبية لفريق التطوير الجديد بالرياض',
    process: { id: 1, name: OPERATION_PROCESSES[0].name },
    process_revision: 2,
    purpose: 'work',
    state: 'pending',
    revision: 1,
    cycle: 1,
    requester: PEOPLE.ahmad,
    created_at: '2026-11-24T08:30:00Z',
    execution_count: 0,
  },
  {
    id: 102,
    name: 'تجديد اشتراك خدمات النسخ الاحتياطي السحابي',
    process: { id: 1, name: OPERATION_PROCESSES[0].name },
    process_revision: 2,
    purpose: 'work',
    state: 'pending',
    revision: 1,
    cycle: 1,
    requester: PEOPLE.noura,
    created_at: '2026-11-23T11:15:00Z',
    execution_count: 0,
  },
  {
    id: 103,
    name: 'منح صلاحية الوصول إلى بيئة التقارير المالية',
    process: { id: 2, name: OPERATION_PROCESSES[1].name },
    process_revision: 1,
    purpose: 'work',
    state: 'returned',
    revision: 2,
    cycle: 2,
    requester: PEOPLE.khalid,
    created_at: '2026-11-22T09:45:00Z',
    execution_count: 0,
  },
  {
    id: 104,
    name: 'تفعيل حسابات البريد الإلكتروني لفرع جدة',
    process: { id: 2, name: OPERATION_PROCESSES[1].name },
    process_revision: 1,
    purpose: 'work',
    state: 'done',
    revision: 3,
    cycle: 1,
    requester: PEOPLE.sara,
    created_at: '2026-11-20T14:00:00Z',
    execution_count: 1,
  },
  {
    id: 105,
    name: 'طلب توسعة سعة التخزين المؤقتة لمشروع الأرشفة',
    process: { id: 1, name: OPERATION_PROCESSES[0].name },
    process_revision: 2,
    purpose: 'work',
    state: 'rejected',
    revision: 2,
    cycle: 1,
    requester: PEOPLE.fahad,
    created_at: '2026-11-18T10:20:00Z',
    execution_count: 0,
  },
]

const HELPDESK_REFERENCE = {
  teams: [
    { id: 1, name: 'الدعم الفني' },
    { id: 2, name: 'خدمة العملاء' },
  ],
  stages: [
    { id: 1, name: 'جديدة', closed: false },
    { id: 2, name: 'قيد المعالجة', closed: false },
    { id: 3, name: 'بانتظار العميل', closed: false },
    { id: 4, name: 'مغلقة', closed: true },
  ],
  categories: [
    { id: 1, name: 'الدخول والصلاحيات' },
    { id: 2, name: 'الفوترة والاشتراكات' },
    { id: 3, name: 'التقارير والتكاملات' },
  ],
  types: [
    { id: 1, name: 'عطل تقني' },
    { id: 2, name: 'استفسار' },
    { id: 3, name: 'طلب خدمة' },
  ],
  channels: [
    { id: 1, name: 'البوابة الإلكترونية' },
    { id: 2, name: 'البريد الإلكتروني' },
    { id: 3, name: 'الهاتف' },
  ],
  tags: [
    { id: 1, name: 'عاجل' },
    { id: 2, name: 'فواتير' },
    { id: 3, name: 'صلاحيات' },
  ],
}

const HELPDESK_TICKETS = [
  {
    id: 41,
    number: 'HD-0041',
    subject: 'تعذر إصدار الفاتورة الضريبية المجمعة لفرع المنطقة الشرقية بعد تحديث بيانات السجل التجاري والربط',
    team: HELPDESK_REFERENCE.teams[0],
    stage: HELPDESK_REFERENCE.stages[0],
    priority: 'urgent',
    assignee: null,
    requester: { kind: 'customer', id: 201, name: 'شركة الرواد للتجارة' },
    category: HELPDESK_REFERENCE.categories[1],
    type: HELPDESK_REFERENCE.types[0],
    channel: HELPDESK_REFERENCE.channels[0],
    tags: [HELPDESK_REFERENCE.tags[0], HELPDESK_REFERENCE.tags[1]],
    sla: {
      state: 'overdue',
      deadline: '2026-11-25T10:00:00Z',
      rows: [{ id: 1, name: 'الرد الأول', state: 'overdue', deadline: '2026-11-25T10:00:00Z', hours: 4 }],
    },
    created_at: '2026-11-24T06:00:00Z',
    last_activity_at: '2026-11-25T09:15:00Z',
  },
  {
    id: 42,
    number: 'HD-0042',
    subject: 'تحديث صلاحيات الدخول للموظفين الجدد في بوابة الموارد البشرية',
    team: HELPDESK_REFERENCE.teams[0],
    stage: HELPDESK_REFERENCE.stages[1],
    priority: 'high',
    assignee: { id: 1, name: 'أحمد العتيبي' },
    requester: { kind: 'employee', id: 12, name: 'سلمان الدوسري' },
    category: HELPDESK_REFERENCE.categories[0],
    type: HELPDESK_REFERENCE.types[2],
    channel: HELPDESK_REFERENCE.channels[1],
    tags: [HELPDESK_REFERENCE.tags[2]],
    sla: {
      state: 'due_soon',
      deadline: '2026-11-26T16:00:00Z',
      rows: [{ id: 2, name: 'الحل النهائي', state: 'due_soon', deadline: '2026-11-26T16:00:00Z', hours: 8 }],
    },
    created_at: '2026-11-25T08:00:00Z',
    last_activity_at: '2026-11-26T07:30:00Z',
  },
  {
    id: 43,
    number: 'HD-0043',
    subject: 'تصدير تقرير المبيعات الشهري بصيغة إكسل لا يظهر عمود الفرع',
    team: HELPDESK_REFERENCE.teams[1],
    stage: HELPDESK_REFERENCE.stages[1],
    priority: 'medium',
    assignee: { id: 2, name: 'نورة الحربي' },
    requester: { kind: 'customer', id: 202, name: 'مؤسسة النخيل للخدمات' },
    category: HELPDESK_REFERENCE.categories[2],
    type: HELPDESK_REFERENCE.types[0],
    channel: HELPDESK_REFERENCE.channels[0],
    tags: [],
    sla: {
      state: 'on_track',
      deadline: '2026-11-28T12:00:00Z',
      rows: [{ id: 3, name: 'الحل النهائي', state: 'on_track', deadline: '2026-11-28T12:00:00Z', hours: 24 }],
    },
    created_at: '2026-11-25T11:30:00Z',
    last_activity_at: '2026-11-26T08:00:00Z',
  },
  {
    id: 44,
    number: 'HD-0044',
    subject: 'استفسار حول خطوات تفعيل المصادقة الثنائية عبر الرسائل النصية',
    team: HELPDESK_REFERENCE.teams[1],
    stage: HELPDESK_REFERENCE.stages[2],
    priority: 'low',
    assignee: { id: 1, name: 'أحمد العتيبي' },
    requester: { kind: 'guest', name: 'ماجد السبيعي' },
    category: HELPDESK_REFERENCE.categories[0],
    type: HELPDESK_REFERENCE.types[1],
    channel: HELPDESK_REFERENCE.channels[2],
    tags: [],
    sla: { state: 'none', deadline: null, rows: [] },
    created_at: '2026-11-24T13:20:00Z',
    last_activity_at: '2026-11-25T15:10:00Z',
  },
  {
    id: 45,
    number: 'HD-0045',
    subject: 'إعادة تعيين كلمة المرور لحساب المحاسب في فرع الدمام',
    team: HELPDESK_REFERENCE.teams[0],
    stage: HELPDESK_REFERENCE.stages[3],
    priority: 'medium',
    assignee: { id: 2, name: 'نورة الحربي' },
    requester: { kind: 'employee', id: 15, name: 'ريم الزهراني' },
    category: HELPDESK_REFERENCE.categories[0],
    type: HELPDESK_REFERENCE.types[2],
    channel: HELPDESK_REFERENCE.channels[1],
    tags: [HELPDESK_REFERENCE.tags[2]],
    sla: { state: 'none', deadline: null, rows: [] },
    created_at: '2026-11-20T09:00:00Z',
    last_activity_at: '2026-11-21T10:45:00Z',
  },
]

const APPOINTMENT_TYPES = [
  {
    id: 1,
    name: 'استشارة مبدئية',
    duration_minutes: 30,
    slot_minutes: 30,
    modifications_deadline_hours: 24,
    own_deadline_hours: null,
    location: 'الفرع الرئيسي - الرياض',
    videocall_location: null,
    resource_calendar_id: 1,
    combination_ids: [1],
    active: true,
  },
  {
    id: 2,
    name: 'مراجعة عقد وخدمات',
    duration_minutes: 45,
    slot_minutes: 15,
    modifications_deadline_hours: 12,
    own_deadline_hours: 12,
    location: 'قاعة الاجتماعات ب',
    videocall_location: 'https://meet.liwan.example/contracts',
    resource_calendar_id: 1,
    combination_ids: [2],
    active: true,
  },
  {
    id: 3,
    name: 'متابعة دورية',
    duration_minutes: 20,
    slot_minutes: 20,
    modifications_deadline_hours: 24,
    own_deadline_hours: null,
    location: null,
    videocall_location: 'https://meet.liwan.example/followup',
    resource_calendar_id: 1,
    combination_ids: [3],
    active: true,
  },
]

function buildAppointmentBookings(day) {
  return [
    {
      id: 141,
      reference: 'APT-2026-0141',
      state: 'confirmed',
      attendance: 'arrived',
      walk_in: false,
      type_id: APPOINTMENT_TYPES[0].id,
      type_name: APPOINTMENT_TYPES[0].name,
      combination_id: 1,
      start: `${day}T07:00:00Z`,
      stop: `${day}T07:30:00Z`,
      duration_minutes: 30,
      requester_name: 'عبدالرحمن بن عبدالله بن محمد آل سعود (شركة الأفق للاستشارات الإدارية)',
    },
    {
      id: 142,
      reference: 'APT-2026-0142',
      state: 'scheduled',
      attendance: null,
      walk_in: false,
      type_id: APPOINTMENT_TYPES[1].id,
      type_name: APPOINTMENT_TYPES[1].name,
      combination_id: 2,
      start: `${day}T08:00:00Z`,
      stop: `${day}T08:45:00Z`,
      duration_minutes: 45,
      requester_name: 'منيرة عبدالعزيز الغامدي',
    },
    {
      id: 143,
      reference: 'APT-2026-0143',
      state: 'scheduled',
      attendance: 'done',
      walk_in: true,
      type_id: APPOINTMENT_TYPES[2].id,
      type_name: APPOINTMENT_TYPES[2].name,
      combination_id: 3,
      start: `${day}T09:30:00Z`,
      stop: `${day}T09:50:00Z`,
      duration_minutes: 20,
      requester_name: 'طارق ناصر السالم',
    },
    {
      id: 144,
      reference: 'APT-2026-0144',
      state: 'pending',
      attendance: null,
      walk_in: false,
      type_id: APPOINTMENT_TYPES[0].id,
      type_name: APPOINTMENT_TYPES[0].name,
      combination_id: null,
      start: null,
      stop: null,
      duration_minutes: 30,
      requester_name: 'هند فهد القحطاني',
    },
    {
      id: 145,
      reference: 'APT-2026-0145',
      state: 'canceled',
      attendance: null,
      walk_in: false,
      type_id: APPOINTMENT_TYPES[1].id,
      type_name: APPOINTMENT_TYPES[1].name,
      combination_id: 2,
      start: `${day}T11:00:00Z`,
      stop: `${day}T11:45:00Z`,
      duration_minutes: 45,
      requester_name: 'فيصل سليمان الحربي',
    },
  ]
}

function filterOperationRequests(url) {
  const scope = url.searchParams.get('scope')
  const state = url.searchParams.get('state')
  const purpose = url.searchParams.get('purpose')
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  return OPERATION_REQUESTS.filter(item =>
    (scope !== 'pending' || item.state === 'pending')
    && (!state || item.state === state)
    && (!purpose || item.purpose === purpose)
    && (!q || `${item.name} ${item.process.name} ${item.requester.name}`.toLowerCase().includes(q)),
  )
}

function filterOperationProcesses(url) {
  const purpose = url.searchParams.get('purpose')
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  return OPERATION_PROCESSES.filter(item =>
    (!purpose || item.purpose === purpose)
    && (!q || `${item.name} ${item.description}`.toLowerCase().includes(q)),
  )
}

function filterHelpdeskTickets(url) {
  const state = url.searchParams.get('state') ?? 'open'
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const team = url.searchParams.get('team')
  const stage = url.searchParams.get('stage')
  const priority = url.searchParams.get('priority')
  const assignee = url.searchParams.get('assignee')
  return HELPDESK_TICKETS.filter(ticket => {
    if (state === 'open' && ticket.stage.closed) return false
    if (state === 'closed' && !ticket.stage.closed) return false
    if (team && ticket.team?.id !== Number(team)) return false
    if (stage && ticket.stage.id !== Number(stage)) return false
    if (priority && ticket.priority !== priority) return false
    if (assignee === 'me' && ticket.assignee?.id !== 1) return false
    if (assignee === 'none' && ticket.assignee !== null) return false
    if (assignee && assignee !== 'me' && assignee !== 'none' && ticket.assignee?.id !== Number(assignee)) return false
    if (q && !`${ticket.subject} ${ticket.number} ${ticket.requester.name}`.toLowerCase().includes(q)) return false
    return true
  })
}

function helpdeskSummary() {
  const open = HELPDESK_TICKETS.filter(ticket => !ticket.stage.closed)
  return {
    open: open.length,
    unassigned: open.filter(ticket => ticket.assignee === null).length,
    mine: open.filter(ticket => ticket.assignee?.id === 1).length,
    overdue: open.filter(ticket => ticket.sla.state === 'overdue').length,
  }
}

function filterAppointmentBookings(url) {
  const fromParam = url.searchParams.get('from')
  const day = fromParam && ISO_DAY.test(fromParam) ? fromParam : new Date().toISOString().slice(0, 10)
  const state = url.searchParams.get('state')
  const typeId = url.searchParams.get('type_id')
  return buildAppointmentBookings(day).filter(booking =>
    (!state || booking.state === state)
    && (!typeId || booking.type_id === Number(typeId)),
  )
}

export function opsDeskPreviewData(normalizedPath, parsedUrl) {
  const url = parsedUrl instanceof URL ? parsedUrl : new URL(String(parsedUrl || 'http://preview.local'), 'http://preview.local')

  if (normalizedPath === '/api/v1/operations/requests') return paginate(filterOperationRequests(url), url)
  if (normalizedPath === '/api/v1/operations/processes') return paginate(filterOperationProcesses(url), url)
  if (normalizedPath === '/api/v1/helpdesk/reference') return HELPDESK_REFERENCE
  if (normalizedPath === '/api/v1/helpdesk/summary') return helpdeskSummary()
  if (normalizedPath === '/api/v1/helpdesk/tickets' || normalizedPath === '/api/v1/helpdesk/requests') {
    return paginate(filterHelpdeskTickets(url), url, 25)
  }
  if (normalizedPath === '/api/v1/appointments/types') return paginate(APPOINTMENT_TYPES, url)
  if (normalizedPath === '/api/v1/appointments/bookings') return paginate(filterAppointmentBookings(url), url)

  return undefined
}
