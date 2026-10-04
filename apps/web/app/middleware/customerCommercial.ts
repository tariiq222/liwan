// 404 unless the customer commercial feature is switched on (non_saas builds never enable it).
export default defineNuxtRouteMiddleware(() => {
  const flag = useRuntimeConfig().public.customerCommercialEnabled
  if (String(flag) !== 'true') return abortNavigation(createError({ statusCode: 404, statusMessage: 'Not Found' }))
})
