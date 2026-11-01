import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { HrOwnOnboardingStepDoneSchema, HrOwnOnboardingStepListSchema } from '@liwan/contracts'
import { useHrOwnIdentity } from './useHrOwnIdentity'

export const hrOwnOnboardingKey = ['hr', 'onboarding', 'mine'] as const
const STEPS_PATH = '/api/v1/hr/self/onboarding-steps'

/** The onboarding steps assigned to the caller on their own onboarding runs (employee read, no onboarding capability). */
export function useMyHrOnboardingSteps(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrOwnOnboardingKey, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && can('hr.employees.read')),
    queryFn: () => $api(STEPS_PATH, { schema: HrOwnOnboardingStepListSchema }),
  })
}

/** Finishing a step is a transition: the list refetches once the server confirmed it. */
export function useCompleteMyHrOnboardingStep() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`${STEPS_PATH}/${id}/done`, { method: 'POST', body: {}, schema: HrOwnOnboardingStepDoneSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrOwnOnboardingKey }),
  })
}
