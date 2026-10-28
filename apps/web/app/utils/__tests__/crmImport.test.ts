import { describe, expect, it } from 'vitest'
import { crmImportErrorMessage, draftFromColumns, importFileProblem, mappingBody, MAX_IMPORT_BYTES } from '../crmImport'

const t = (key: string) => key
const fail = (status: number, field?: string, message = 'server text') => ({ status, field, message })

describe('importFileProblem', () => {
  it('accepts csv and xlsx files up to 5 MB', () => {
    expect(importFileProblem({ name: 'Leads.CSV', size: 10 })).toBeNull()
    expect(importFileProblem({ name: 'a.xlsx', size: MAX_IMPORT_BYTES })).toBeNull()
  })
  it('names a wrong type, an empty file and a file that is too large', () => {
    expect(importFileProblem({ name: 'a.pdf', size: 10 })).toBe('type')
    expect(importFileProblem({ name: 'a.csv', size: 0 })).toBe('empty')
    expect(importFileProblem({ name: 'a.csv', size: MAX_IMPORT_BYTES + 1 })).toBe('tooLarge')
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
  it('translates each file refusal of the server', () => {
    const file = (message: string) => crmImportErrorMessage(fail(422, 'file', message), t)
    expect(file('the file is larger than 5 MB')).toBe('crm.imports.errors.file.tooLarge')
    expect(file('the file has more than 5000 rows')).toBe('crm.imports.errors.file.tooManyRows')
    expect(file('the file has more than 50 columns')).toBe('crm.imports.errors.file.tooManyColumns')
    expect(file('duplicate_header')).toBe('crm.imports.errors.file.duplicateHeader')
    expect(file('the file must be saved as UTF-8')).toBe('crm.imports.errors.file.encoding')
    expect(file('the file is not a valid CSV file')).toBe('crm.imports.errors.file.unreadable')
    expect(file('the file is empty')).toBe('crm.imports.errors.file.noRows')
    expect(file('the file has no rows')).toBe('crm.imports.errors.file.noRows')
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
    expect(crmImportErrorMessage(fail(422, 'file_name'), t)).toBe('crm.imports.errors.fileType')
    expect(crmImportErrorMessage(new Error('x'), t)).toBe('errors.generic')
  })
})
