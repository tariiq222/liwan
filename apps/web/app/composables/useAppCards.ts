import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { CancelledError, useQueries, useQueryClient } from '@tanstack/vue-query'
import { activeManifests } from '../modules/manifests'
import type { AppCard, AppCardFigure, AppCardSurface, AppIcon } from '../modules/types'
import type { AccessIdentity } from '../utils/accessPolicy'
import { ASSISTANT_MODULE_ID, reachableApplications } from './nav/launcherModel'
import { visibleShellModules } from './nav/shellModules'

export type AppCardCategory = AppCard['category']
export type AppCardFilter = 'all' | AppCardCategory
/** The filter chips, in the order home shows them (after «الكل»). */
export const APP_CARD_CATEGORIES: readonly AppCardCategory[] = ['sales', 'team']

/** Most figures a card shows. */
const MAX_FIGURES = 2
/** An application that declares no card is a specialised team application. */
const DEFAULT_CARD: AppCard = { category: 'team', plan: 'addon' }
const FIGURE_STALE_MS = 30_000

export interface AppCardModel {
  id: string
  labelKey: string
  icon: AppIcon
  to: string
  /** The core applications (the assistant, tasks, meetings, conversations, documents) are always in the sidebar's icon row, so they take no pin. */
  pinnable: boolean
  category: AppCardCategory
  plan: AppCard['plan']
  surface: AppCardSurface
  figures: readonly AppCardFigure[]
}

/**
 * The applications this identity may open, in rail order, each with the card its manifest declares. Home leaves the
 * assistant out (it has its own banner); the all-applications page lists it first.
 */
export function appCardModels(identity: AccessIdentity, options: { assistant: boolean }): AppCardModel[] {
  const modules = visibleShellModules(identity)
  const listed = options.assistant ? modules.filter(module => module.id !== 'home' && module.id !== 'settings') : reachableApplications(modules)
  return listed
    .map((module): AppCardModel => {
      const card = activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module.id))?.appCard ?? DEFAULT_CARD
      return {
        id: module.id, labelKey: module.labelKey, icon: module.icon, to: module.to, pinnable: module.core === undefined,
        category: card.category, plan: card.plan, surface: card.surface ?? 'lav', figures: (card.figures ?? []).slice(0, MAX_FIGURES),
      }
    })
    .sort((a, b) => Number(b.id === ASSISTANT_MODULE_ID) - Number(a.id === ASSISTANT_MODULE_ID))
}

/** The cards a filter chip keeps; «الكل» keeps them all. */
export function filterAppCards(cards: readonly AppCardModel[], filter: AppCardFilter): AppCardModel[] {
  return filter === 'all' ? [...cards] : cards.filter(card => card.category === filter)
}

/** The categories among the cards, in chip order: a chip for a category nobody can see would filter to nothing. */
export function presentCategories(cards: readonly AppCardModel[]): AppCardCategory[] {
  return APP_CARD_CATEGORIES.filter(category => cards.some(card => card.category === category))
}

export function useAppCards(options: { assistant: boolean }) {
  const { me } = useMe()
  return { cards: computed(() => appCardModels(me.value, options)) }
}

/**
 * The live numbers of one card, through the caller's own session. A figure the caller's capability does not allow is never
 * asked; one that is pending or failed is left out (never a wrong zero), so the card shows only what arrived.
 */
export function useAppFigures(figures: MaybeRefOrGetter<readonly AppCardFigure[]>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  const hydrated = useHydrated()
  const client = useQueryClient()
  const owner = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  const ready = computed(() => hydrated.value && !!owner.value.companyId && !!owner.value.userId)
  const visible = computed(() => toValue(figures).filter(figure => !figure.capability || can(figure.capability)))
  const queries = computed(() => visible.value.map(figure => {
    const asked = owner.value
    const current = () => ready.value && asked.companyId === owner.value.companyId && asked.userId === owner.value.userId
    return {
      queryKey: [...figure.queryKey, asked],
      queryFn: async () => {
        if (!current()) throw new CancelledError({ revert: true })
        const value = await figure.load($api)
        if (!current()) throw new CancelledError({ revert: true })
        return value
      },
      enabled: ready.value,
      retry: false,
      staleTime: FIGURE_STALE_MS,
    }
  }))
  const results = useQueries({ queries })
  return computed(() => visible.value.flatMap((figure, index) => {
    // Observer updates are queued: track them, but read by the current key so an owner change never shows old data.
    void results.value[index]
    const value = ready.value ? client.getQueryData<number | null>(queries.value[index]!.queryKey) : undefined
    return typeof value === 'number' ? [{ labelKey: figure.labelKey, value }] : []
  }))
}
