import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAuditRequestSchema } from '@nasq/contracts'
import { aiApprovalAudit, charterDraftFromAi, clearAiDraft, clearAiSessionState, forgetCreatedId, mayFinalizeCreate, parseCreatedId, readAiDraft, readCreatedId, rememberCreatedId, withCreatedProject, withoutCreated } from '../aiDraft'
import { emptyCharterDraft } from '../projectCharter'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'

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

describe('charterDraftFromAi', () => {
  it('fills known fields and turns objectives into rows', () => {
    const draft = charterDraftFromAi({ name: 'بوابة', description: 'وصف', date_start: '2026-11-01', date_end: '2027-03-31', charter: { rationale: 'لماذا', objectives: ['أ', 'ب'], scope: 'نطاق' } }, emptyCharterDraft())
    expect(draft.name).toBe('بوابة')
    expect(draft.description).toBe('وصف')
    expect([draft.dateStart, draft.dateEnd]).toEqual(['2026-11-01', '2027-03-31'])
    expect(draft.rationale).toBe('لماذا')
    expect(draft.scope).toBe('نطاق')
    expect(draft.objectives.map(o => o.goal)).toEqual(['أ', 'ب'])
    expect(draft.objectives.every(o => !o.persisted)).toBe(true)
  })

  it('leaves untouched fields at their base values', () => {
    const base = emptyCharterDraft()
    base.userId = 9
    const draft = charterDraftFromAi({ name: 'x' }, base)
    expect(draft.userId).toBe(9)
    expect(draft.objectives).toHaveLength(1)
    expect(draft.typeId).toBeNull()
    expect(draft.budgetState).toBe('unknown')
  })
})

describe('readAiDraft / clearAiDraft', () => {
  beforeEach(() => stubStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('reads a valid handoff and drops it on clear', () => {
    stubStorage({ 'nasq:ai-draft:r_1:c_2': JSON.stringify(handoff) })
    expect(readAiDraft('r_1:c_2')?.payload.name).toBe('بوابة')
    clearAiDraft('r_1:c_2')
    expect(readAiDraft('r_1:c_2')).toBeNull()
  })

  it('returns null for a missing, corrupt or invalid entry', () => {
    stubStorage({
      'nasq:ai-draft:bad': '{not json',
      'nasq:ai-draft:empty-name': JSON.stringify({ ...handoff, payload: { name: '   ' } }),
      'nasq:ai-draft:no-name': JSON.stringify({ ...handoff, payload: { description: 'x' } }),
      'nasq:ai-draft:extra': JSON.stringify({ ...handoff, evil: true }),
    })
    for (const id of ['missing', 'bad', 'empty-name', 'no-name', 'extra']) expect(readAiDraft(id)).toBeNull()
  })

  it('ignores unknown payload keys', () => {
    stubStorage({ 'nasq:ai-draft:k': JSON.stringify({ ...handoff, payload: { name: 'x', budget: 99, charter: { scope: 's', salary: 1 } } }) })
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
    stubStorage({ 'nasq:ai-created:r_1:c_2': '-5' })
    expect(readCreatedId('r_1', 'c_2')).toBeNull()
    const denied = () => { throw new Error('denied') }
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied, key: denied, get length() { return denied() } })
    expect(() => { rememberCreatedId('r_1', 'c_2', 1); forgetCreatedId('r_1', 'c_2'); clearAiSessionState() }).not.toThrow()
    expect(readCreatedId('r_1', 'c_2')).toBeNull()
  })
  it('sign-out clears every AI draft and created id and nothing else', () => {
    const store = stubStorage({ 'nasq:ai-draft:r_1:c_2': '{}', 'nasq:ai-created:r_1:c_2': '41', 'nasq:ai-draft:r_3:c_1': '{}', 'nasq-nav:7': 'x' })
    clearAiSessionState()
    expect([...store.keys()]).toEqual(['nasq-nav:7'])
  })
})
