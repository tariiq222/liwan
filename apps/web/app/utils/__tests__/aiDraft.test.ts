import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAuditRequestSchema } from '@liwan/contracts'
import { aiApprovalAudit, projectBasicsFromAi, clearAiDraft, clearAiSessionState, forgetCreatedId, mayFinalizeCreate, parseCreatedId, prepareDraftHandoff, readAiDraft, readCreatedId, rememberCreatedId, withCreatedProject, withoutCreated } from '../aiDraft'
const emptyBasics = () => ({name:'',description:'',objectives:[{goal:'',metric:'',target:''}],success_criteria:'',user_id:9,date_start:null,date_end:null})
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

const handoff = { run_id: 'r_1', call_id: 'c_2', tool: 'projects.draft_project', payload: { name: 'بوابة' } }

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('sessionStorage', {
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  return store
}

describe('projectBasicsFromAi', () => {
  it('maps every structured objective and success criteria into the core draft', () => {
    const draft = projectBasicsFromAi({name:'Portal',objectives:[{goal:'A',metric:'count',target:'20'},{goal:'B'}],success_criteria:'20 in one month'},emptyBasics())
    expect(draft.objectives).toEqual([{goal:'A',metric:'count',target:'20'},{goal:'B',metric:'',target:''}])
    expect(draft.success_criteria).toBe('20 in one month')
    expect(draft.user_id).toBe(9)
  })
  it('retains the advertised start date',()=>{expect(projectBasicsFromAi({name:'AI',date_start:'2030-02-01',date_end:'2030-03-01'},emptyBasics())).toMatchObject({date_start:'2030-02-01',date_end:'2030-03-01'})})
  it('preserves fields not provided by the draft', () => {
    expect(projectBasicsFromAi({name:'Portal'},emptyBasics())).toEqual({...emptyBasics(),name:'Portal'})
  })
})

describe('readAiDraft / clearAiDraft', () => {
  beforeEach(() => stubStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('reads a valid handoff and drops it on clear', () => {
    stubStorage({ 'liwan:ai-draft:r_1:c_2': JSON.stringify(handoff) })
    expect(readAiDraft('r_1:c_2')?.payload.name).toBe('بوابة')
    clearAiDraft('r_1:c_2')
    expect(readAiDraft('r_1:c_2')).toBeNull()
  })

  it('returns null for a missing, corrupt or invalid entry', () => {
    stubStorage({
      'liwan:ai-draft:bad': '{not json',
      'liwan:ai-draft:empty-name': JSON.stringify({ ...handoff, payload: { name: '   ' } }),
      'liwan:ai-draft:no-name': JSON.stringify({ ...handoff, payload: { description: 'x' } }),
      'liwan:ai-draft:extra': JSON.stringify({ ...handoff, evil: true }),
    })
    for (const id of ['missing', 'bad', 'empty-name', 'no-name', 'extra']) expect(readAiDraft(id)).toBeNull()
  })

  it('ignores unknown payload keys', () => {
    stubStorage({ 'liwan:ai-draft:k': JSON.stringify({ ...handoff, payload: { name: 'x', budget: 99, charter: { scope: 's', salary: 1 } } }) })
    expect(readAiDraft('k')?.payload).toEqual({ name: 'x', charter: { scope: 's' } })
  })

  it('does not throw when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } })
    expect(readAiDraft('k')).toBeNull()
    expect(() => clearAiDraft('k')).not.toThrow()
  })
})

describe('approval audit and return path', () => {
  it('builds an audit row the contract accepts', () => {
    const body = aiApprovalAudit(handoff, 42)
    expect(AiAuditRequestSchema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({ conversation_id: 'r_1', kind: 'draft', result: 'approved', http_status: 201, approved: { id: 42 }, attested: true })
  })

  it('accepts the /ai returnTo only when /ai is allowed and keeps its query', () => {
    expect(safeReturnTo('/ai?run=r_1&resume=c_2', '/projects', ['/projects', '/ai'])).toBe('/ai?run=r_1&resume=c_2')
    expect(safeReturnTo('/ai?run=r_1&resume=c_2', '/projects', ['/projects'])).toBe('/projects')
    expect(safeReturnTo('/aiX?run=1', '/projects', ['/projects', '/ai'])).toBe('/projects')
  })

  it('appends created to a returnTo with or without a query', () => {
    expect(withCreatedProject('/ai?run=r_1&resume=c_2', 7)).toBe('/ai?run=r_1&resume=c_2&created=7')
    expect(withCreatedProject('/ai', 7)).toBe('/ai?created=7')
  })
})

describe('audit only for a handoff', () => {
  it('produces no audit without a handoff', () => {
    expect(aiApprovalAudit(null, 42)).toBeNull()
    expect(aiApprovalAudit(handoff, 42)).toMatchObject({ approved: { id: 42 }, attested: true })
  })
})

describe('cancel return location', () => {
  it('drops created so /ai reads the return as a rejection', () => {
    expect(withoutCreated('/ai?run=r_1&resume=c_2&created=7')).toBe('/ai?run=r_1&resume=c_2')
    expect(withoutCreated('/ai?run=r_1&resume=c_2')).toBe('/ai?run=r_1&resume=c_2')
    expect(withoutCreated('/projects?q=a#top')).toBe('/projects?q=a#top')
  })
})

describe('parseCreatedId', () => {
  it('accepts only a positive plain integer', () => {
    expect(parseCreatedId('41')).toBe(41)
    for (const bad of ['0', '-3', '1.5', '1e2', '0x10', '', ' 7', 'abc', undefined, null, ['1']]) expect(parseCreatedId(bad as never)).toBeNull()
  })
})

describe('mayFinalizeCreate', () => {
  it('refuses a final create that needs attestation until attested', () => {
    expect(mayFinalizeCreate(true, false)).toBe(false)
    expect(mayFinalizeCreate(true, true)).toBe(true)
    expect(mayFinalizeCreate(false, false)).toBe(true)
    expect(mayFinalizeCreate(undefined, false)).toBe(true)
  })
})

describe('created project memory', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the created id per run and call until it is forgotten', () => {
    stubStorage()
    expect(readCreatedId('r_1', 'c_2')).toBeNull()
    rememberCreatedId('r_1', 'c_2', 41)
    expect(readCreatedId('r_1', 'c_2')).toBe(41)
    expect(readCreatedId('r_1', 'c_3')).toBeNull()
    expect(readCreatedId('r_2', 'c_2')).toBeNull()
    forgetCreatedId('r_1', 'c_2')
    expect(readCreatedId('r_1', 'c_2')).toBeNull()
  })
  it('reads a tampered value as no project and survives denied storage', () => {
    stubStorage({ 'liwan:ai-created:r_1:c_2': '-5' })
    expect(readCreatedId('r_1', 'c_2')).toBeNull()
    const denied = () => { throw new Error('denied') }
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied, key: denied, get length() { return denied() } })
    expect(() => { rememberCreatedId('r_1', 'c_2', 1); forgetCreatedId('r_1', 'c_2'); clearAiSessionState() }).not.toThrow()
    expect(readCreatedId('r_1', 'c_2')).toBeNull()
  })
  it('sign-out clears every AI draft and created id and nothing else', () => {
    const store = stubStorage({ 'liwan:ai-draft:r_1:c_2': '{}', 'liwan:ai-created:r_1:c_2': '41', 'liwan:ai-draft:r_3:c_1': '{}', 'liwan-nav:7': 'x' })
    clearAiSessionState()
    expect([...store.keys()]).toEqual(['liwan-nav:7'])
  })
})

describe('prepareDraftHandoff', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the draft for the create page and returns to the assistant for the decision', () => {
    const store = stubStorage()
    const target = prepareDraftHandoff('r_1', { callId: 'c_2', tool: 'projects.draft_project', payload: { name: 'بوابة' } })
    expect(target).toEqual({ path: '/projects/new', query: { aiDraft: 'r_1:c_2', returnTo: '/ai?run=r_1&resume=c_2' } })
    expect(readAiDraft('r_1:c_2')).toEqual(handoff)
    expect(store.size).toBe(1)
  })

  it('still opens the form, empty, when the payload has no usable name', () => {
    const store = stubStorage()
    prepareDraftHandoff('r_1', { callId: 'c_2', tool: 'projects.draft_project', payload: {} })
    expect(JSON.parse(store.get('liwan:ai-draft:r_1:c_2')!).payload).toEqual({})
  })

  it('opens the form even when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('blocked') } })
    expect(prepareDraftHandoff('r_1', { callId: 'c_2', tool: 't', payload: {} }).path).toBe('/projects/new')
  })
})
