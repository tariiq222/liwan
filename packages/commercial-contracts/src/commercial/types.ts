export * from './schemas.js'

export class CommercialError extends Error {
  readonly code: string
  readonly field?: string
  constructor(code: string, field?: string) {
    super(code)
    this.name = 'CommercialError'
    this.code = code
    this.field = field
  }
}
