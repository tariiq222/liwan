import type { AppIcon } from '../../modules/types'
import { activeManifests } from '../../modules/manifests'
import type { AccessIdentity } from '../../utils/accessPolicy'
import { visibleShellModules, type ShellModuleDefinition } from './shellModules'
import { visibleCommands } from './paletteModel'
import { appStartFor, type StartCard } from './appStartModel'

export interface LauncherEntry {
  id: string
  labelKey: string
  icon: AppIcon
  to: string
  actions: StartCard[]
  pinnable: boolean
}

export function reachableApplications(modules: readonly ShellModuleDefinition[]): ShellModuleDefinition[] {
  const applications = modules.filter(module => module.id !== 'home' && module.id !== 'settings')
  return [...applications.filter(module => !module.utility), ...applications.filter(module => module.utility)]
}

/** Existing application actions, filtered by feature and route permissions, never executed by the launcher. */
export function launcherEntries(identity: AccessIdentity, query: string, translate: (key: string) => string): LauncherEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  return reachableApplications(visibleShellModules(identity))
    .filter(module => !needle || translate(module.labelKey).toLocaleLowerCase().includes(needle))
    .map(module => {
      const owner = activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module.id))
      const start = appStartFor(module.id, identity)
      const candidates = [...visibleCommands(identity, owner?.commands ?? []), ...(start.kind === 'ready' ? start.creates : [])]
      const seen = new Set<string>()
      const actions = candidates.filter(action => {
        if (action.to === module.to || seen.has(action.to)) return false
        seen.add(action.to)
        return true
      }).slice(0, 3)
      return { id: module.id, labelKey: module.labelKey, icon: module.icon, to: module.to, actions, pinnable: !module.utility }
    })
}
