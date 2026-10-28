import type { CrmImportColumns, CrmImportFile, CrmImportInvalidReason } from '@webvue/contracts'
import { fileToBase64 } from './attachmentFile'
import { saveErrorMessage } from './formFeedback'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const IMPORT_ACCEPT = '.csv,.xlsx'
export const IMPORT_FIELDS = ['name', 'phone', 'email', 'notes', 'package'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ['name', 'phone']

/** The file as the import routes take it: its name and its bytes as base64. */
export async function readImportFile(file: File): Promise<CrmImportFile> {
  return { file_name: file.name, content_base64: await fileToBase64(file) }
}

export type ImportFileProblem = 'empty' | 'tooLarge' | 'type'

/** What is wrong with a chosen file before anything is sent; the server stays the authority. */
export function importFileProblem(file: { name: string; size: number }): ImportFileProblem | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) return 'type'
  if (file.size <= 0) return 'empty'
  return file.size > MAX_IMPORT_BYTES ? 'tooLarge' : null
}

/** Column choices of the mapping step; an unset optional field is simply absent. */
export type MappingDraft = Partial<Record<ImportField, string>>

export const mappingIsComplete = (draft: MappingDraft) => REQUIRED_IMPORT_FIELDS.every(field => Boolean(draft[field]))

/** The `mapping` body for the draft, or null while a required field has no column. */
export function mappingBody(draft: MappingDraft): CrmImportColumns | null {
  if (!mappingIsComplete(draft)) return null
  const body: CrmImportColumns = { name: draft.name!, phone: draft.phone! }
  for (const field of ['email', 'notes', 'package'] as const) if (draft[field]) body[field] = draft[field]
  return body
}

/** A saved profile's columns as a draft, dropping the fields it leaves out. */
export function draftFromColumns(columns: Record<ImportField, string | null>): MappingDraft {
  return Object.fromEntries(IMPORT_FIELDS.filter(field => columns[field]).map(field => [field, columns[field]!])) as MappingDraft
}

export const invalidReasonKey = (reason: CrmImportInvalidReason) => `crm.imports.reasons.${reason}`

// The file refusals are English sentences of the server (intake.py); each one has a stable pattern.
const FILE_REFUSALS: [pattern: RegExp, key: string][] = [
  [/5 MB/, 'tooLarge'],
  [/more than \d+ rows/, 'tooManyRows'],
  [/more than \d+ columns/, 'tooManyColumns'],
  [/duplicate_header/, 'duplicateHeader'],
  [/UTF-8/, 'encoding'],
  [/valid (?:CSV|XLSX)/, 'unreadable'],
  [/is empty|no rows/, 'noRows'],
]

type Translate = (key: string) => string

/**
 * What a refused import call says, in the user's words. `agentChosen` tells the two refusals of `user_id` apart:
 * with an agent sent, distribution is not "on import" or the agent cannot take records; without one, an agent is required.
 */
export function crmImportErrorMessage(error: unknown, t: Translate, options: { agentChosen?: boolean } = {}): string {
  const { status, field, message } = (error ?? {}) as { status?: number; field?: string; message?: string }
  if (status === 403) return t('crm.imports.errors.forbidden')
  if (status === 409 && field === 'name') return t('crm.imports.errors.profileExists')
  if (status === 404) return t('crm.imports.errors.profileGone')
  if (status === 422 && field === 'file_name') return t('crm.imports.errors.fileType')
  if (status === 422 && (field === 'file' || field === 'content_base64')) {
    const refusal = FILE_REFUSALS.find(([pattern]) => pattern.test(message ?? ''))
    return t(`crm.imports.errors.file.${refusal?.[1] ?? 'unreadable'}`)
  }
  if (status === 422 && (field === 'mapping' || field === 'mapping_profile')) return t('crm.imports.errors.mapping')
  if (status === 422 && field === 'source_id') return t('crm.imports.errors.source')
  if (status === 422 && field === 'user_id') return t(options.agentChosen ? 'crm.imports.errors.agentRefused' : 'crm.imports.errors.agentRequired')
  return saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}
