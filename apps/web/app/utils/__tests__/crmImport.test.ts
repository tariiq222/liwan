import { describe, expect, it } from 'vitest'
import { CrmImportFileReasonSchema } from '@liwan/contracts'
import { crmImportErrorMessage, draftFromColumns, importFileProblem, mappingBody, MAX_IMPORT_BYTES } from '../crmImport'

const t = (key: string) => key
const fail = (status: number, field?: string, message = 'server text') => ({ status, field, message })

describe('importFileProblem', () => {
  it('accepts csv and xlsx files up to 5 MB', () => {
    expect(importFileProblem({ name: 'Leads.CSV', size: 10 })).toBeNull()
    expect(importFileProblem({ name: 'a.xlsx', size: MAX_IMPORT_BYTES })).toBeNull()
  })
  it('names a wrong type, an empty file and a file that is too large', () => {
    expect(importFileProblem({ name: 'a.pdf', size: 10 })).toBe('file_bad_type')
    expect(importFileProblem({ name: 'a.csv', size: 0 })).toBe('file_empty')
    expect(importFileProblem({ name: 'a.csv', size: MAX_IMPORT_BYTES + 1 })).toBe('file_too_large')
  })
})

describe('mapping drafts', () => {
  it('needs name and phone and leaves unset optional fields out', () => {
    expect(mappingBody({ name: 'Name' })).toBeNull()
    expect(mappingBody({ name: 'Name', phone: 'Phone' })).toEqual({ name: 'Name', phone: 'Phone' })
    expect(mappingBody({ name: 'Name', phone: 'Phone', email: 'Mail', notes: '' })).toEqual({ name: 'Name', phone: 'Phone', email: 'Mail' })
  })
  it('turns a profile into a draft without its empty columns', () => {
    expect(draftFromColumns({ name: 'A', phone: 'B', email: null, notes: 'C', package: null })).toEqual({ name: 'A', phone: 'B', notes: 'C' })
  })
})

describe('crmImportErrorMessage', () => {
  it('translates each file refusal by its machine code, never by its text', () => {
    const file = (reason: string, field = 'file') => crmImportErrorMessage({ status: 422, field, message: 'any text at all', details: { reason } }, t)
    expect(file('file_too_large')).toBe('crm.imports.errors.file.file_too_large')
    for (const reason of CrmImportFileReasonSchema.options) expect(file(reason, reason === 'file_bad_type' ? 'file_name' : 'file')).toBe(`crm.imports.errors.file.${reason}`)
  })
  it('falls back to the generic text for a file refusal without a known code', () => {
    expect(crmImportErrorMessage(fail(422, 'file', 'the file is larger than 5 MB'), t)).toBe('errors.generic')
  })
  it('tells the two refusals of the agent apart', () => {
    expect(crmImportErrorMessage(fail(422, 'user_id'), t)).toBe('crm.imports.errors.agentRequired')
    expect(crmImportErrorMessage(fail(422, 'user_id'), t, { agentChosen: true })).toBe('crm.imports.errors.agentRefused')
  })
  it('names the other refusals', () => {
    expect(crmImportErrorMessage(fail(403), t)).toBe('crm.imports.errors.forbidden')
    expect(crmImportErrorMessage(fail(409, 'name'), t)).toBe('crm.imports.errors.profileExists')
    expect(crmImportErrorMessage(fail(422, 'mapping'), t)).toBe('crm.imports.errors.mapping')
    expect(crmImportErrorMessage(fail(422, 'source_id'), t)).toBe('crm.imports.errors.source')
    expect(crmImportErrorMessage(new Error('x'), t)).toBe('errors.generic')
  })
})
