declare module 'virtual:nasq-i18n' {
  export const locales: { code: string; language: string; dir: 'rtl' | 'ltr' }[]
  const messages: Record<string, Record<string, unknown>>
  export default messages
}
