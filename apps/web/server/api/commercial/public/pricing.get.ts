import { forwardPublicPricing } from '../../../utils/customer-commercial'

// Public, common host only: the published offer for the marketing site (separate origin, CORS allowlist). No cookie, no tenant.
export default defineEventHandler(forwardPublicPricing)
