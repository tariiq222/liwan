// Personal task fixtures shared by the my-tasks mock wrapper (server-rendered first paint) and the specs
// (browser-side `page.route` fakes), so both start from the same shapes.
export const ADMIN = { id: 2, name: 'Admin', user_id: 2 }
export const SARA = { id: 5, name: 'سارة محمد', user_id: 5 }

const OPEN_ACTIONS = { write: true, done: true, reopen: false, cancel: true, convert: false, archive: false, unarchive: false }
const CLOSED_ACTIONS = { write: false, done: false, reopen: true, cancel: false, convert: false, archive: true, unarchive: false }

export function personalTask(id, overrides = {}) {
  return {
    id,
    name: 'اشترِ الورق',
    description: 'ورق A4 للطابعة',
    state: 'open',
    priority: 'normal',
    date_deadline: '2026-10-20T21:30:00Z',
    assignees: [ADMIN],
    creator: ADMIN,
    parent: null,
    is_subtask: false,
    subtasks: [],
    attachment_count: 0,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    allowed_actions: OPEN_ACTIONS,
    ...overrides,
  }
}

export const closedActions = () => ({ ...CLOSED_ACTIONS })
export const openActions = () => ({ ...OPEN_ACTIONS })

// Ids the wrapper answers while rendering on the server.
export const SSR_TASKS = {
  7: personalTask(7, { subtasks: [{ id: 11, name: 'اطبع القائمة', state: 'open' }] }),
  8: personalTask(8, { allowed_actions: { ...OPEN_ACTIONS, convert: true } }),
  9: personalTask(9, { state: 'done', allowed_actions: CLOSED_ACTIONS }),
  10: personalTask(10, { name: 'اطبع القائمة', is_subtask: true, parent: { id: 7, name: 'اشترِ الورق' } }),
  11: personalTask(11, { name: 'اطبع القائمة', is_subtask: true, parent: { id: 7, name: 'اشترِ الورق' } }),
  12: personalTask(12, { name: 'مهمة بتعليقات' }),
  13: personalTask(13, { name: 'موعد عند منتصف الليل', date_deadline: '2026-10-13T00:00:00Z' }),
  14: personalTask(14, { name: 'مهمة فرعية بأب مخفي', is_subtask: true, parent: null }),
}

// Comments the wrapper serves for the first paint, by task id (the others have none).
export const SSR_COMMENTS = {
  12: [{ id: 1, body: 'تعليق قديم <b>نص</b>', author: null, created_at: '2026-10-02T09:00:00Z' }],
}

export const CONVERT_TARGETS = [{ id: 1, name: 'مشروع الأتمتة' }, { id: 2, name: 'مشروع التسويق' }]

// Initial SSR list for whole-journey checks. Existing list specs override the
// browser response with their own rows; these use the same readable records.
export const SSR_LIST = [
  { id: 7, name: SSR_TASKS[7].name, state: 'open', priority: 'normal', date_deadline: SSR_TASKS[7].date_deadline,
    assignees: [ADMIN], source: 'personal', project: null, href: '/my-tasks/7' },
  { id: 101, name: 'مهمة جارية', state: 'open', priority: 'normal', date_deadline: '2035-01-15T00:00:00Z',
    assignees: [ADMIN], source: 'project', project: { id: 1, name: 'مشروع ألفا' }, href: '/projects/1/tasks/101' },
]
