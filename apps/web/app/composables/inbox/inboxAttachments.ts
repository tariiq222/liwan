// What an agent may attach to a WhatsApp reply, checked in the composer before the upload so a refusal is immediate.
// The limits are Meta's media rules narrowed by the platform: it caps every request at 16 MiB, and the server answers
// 413 `payload_too_large` above the same sizes, which is what the composer prevents.

const MIB = 1024 * 1024
export const INBOX_IMAGE_MAX_BYTES = 5 * MIB
export const INBOX_FILE_MAX_BYTES = 15 * MIB

const IMAGE_TYPES = ['image/jpeg', 'image/png']
const VIDEO_TYPES = ['video/mp4', 'video/3gpp']
const AUDIO_TYPES = ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg']

/** The `accept` list of the file picker: the media WhatsApp takes plus common documents. */
export const INBOX_UPLOAD_ACCEPT = [
  ...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES,
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
].join(',')

export type InboxUploadProblem = { reason: 'empty' | 'unsupported' } | { reason: 'tooLarge'; limitMb: number }

/** Why a file cannot be sent, or null when it can. Image, video and audio types outside WhatsApp's list are refused; any other type is a document. */
export function inboxUploadProblem(file: { type: string; size: number }): InboxUploadProblem | null {
  if (file.size <= 0) return { reason: 'empty' }
  const family = file.type.split('/')[0]
  const media = family === 'image' ? IMAGE_TYPES : family === 'video' ? VIDEO_TYPES : family === 'audio' ? AUDIO_TYPES : undefined
  if (media && !media.includes(file.type)) return { reason: 'unsupported' }
  const limit = family === 'image' ? INBOX_IMAGE_MAX_BYTES : INBOX_FILE_MAX_BYTES
  return file.size > limit ? { reason: 'tooLarge', limitMb: limit / MIB } : null
}

/** The size a file row shows. */
export function inboxFileSize(bytes: number): string {
  return bytes >= MIB ? `${(bytes / MIB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
