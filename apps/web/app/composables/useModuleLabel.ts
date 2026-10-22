import { shellModuleList } from './nav/shellModules'

/** The rail label of a module id (a row's source application); an unknown id is shown as it is. */
export function useModuleLabel(): (module: string) => string {
  const { t } = useI18n()
  const labelKeys = new Map(shellModuleList().map(module => [module.id, module.labelKey]))
  return (module) => {
    const key = labelKeys.get(module)
    return key ? t(key) : module
  }
}
